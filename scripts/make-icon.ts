// Regenerates build/icon.png, which electron-builder turns into the app's .ico.
import { mkdirSync, writeFileSync } from 'node:fs';
import { COLORS, markPng } from '../electron/icon';

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', markPng(512, { color: COLORS.running, background: COLORS.background }));
console.log('Wrote build/icon.png');
