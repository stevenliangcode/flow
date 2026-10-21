// Draws Flow's half-filled circle mark as PNGs at any size, so the app ships no image assets
// for the tray. Also used by scripts/make-icon.ts to produce build/icon.png for the installer.
import { crc32, deflateSync } from 'node:zlib';

export type Rgb = [number, number, number];

export const COLORS = {
  running: [60, 207, 122] as Rgb,
  paused: [242, 180, 65] as Rgb,
  idle: [150, 154, 146] as Rgb,
  background: [17, 19, 17] as Rgb,
};

interface MarkOptions {
  color: Rgb;
  /** Rounded-square background behind the mark (app icon), or transparent (tray). */
  background?: Rgb;
}

const SUPERSAMPLE = 4;

/** Coverage (0..1) of the mark at a point in unit coordinates centred on 0,0. */
function markCoverage(x: number, y: number, radius: number): number {
  const d = Math.hypot(x, y);
  const ring = radius * 0.2;
  const gap = radius * 0.14;
  if (d <= radius && d >= radius - ring) return 1; // outer ring
  if (d <= radius - ring - gap && x <= 0) return 1; // left half filled
  return 0;
}

function insideRoundedSquare(x: number, y: number, half: number, corner: number): boolean {
  const qx = Math.abs(x) - (half - corner);
  const qy = Math.abs(y) - (half - corner);
  if (qx <= 0 || qy <= 0) return Math.abs(x) <= half && Math.abs(y) <= half;
  return Math.hypot(qx, qy) <= corner;
}

/** Renders the mark to RGBA pixels. */
export function renderMark(size: number, { color, background }: MarkOptions): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = background ? 0.3 : 0.46;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let mark = 0;
      let bg = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size - 0.5;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size - 0.5;
          mark += markCoverage(x, y, radius);
          if (background && insideRoundedSquare(x, y, 0.5, 0.22)) bg += 1;
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const markA = mark / samples;
      const bgA = bg / samples;
      const i = (py * size + px) * 4;
      if (background) {
        // Mark over background, then the whole thing clipped by the rounded square.
        for (let c = 0; c < 3; c++) {
          pixels[i + c] = Math.round(color[c] * markA + background[c] * (1 - markA));
        }
        pixels[i + 3] = Math.round(bgA * 255);
      } else {
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = Math.round(markA * 255);
      }
    }
  }
  return pixels;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Minimal PNG encoder for 8-bit RGBA pixels. */
export function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function markPng(size: number, options: MarkOptions): Buffer {
  return encodePng(renderMark(size, options), size, size);
}
