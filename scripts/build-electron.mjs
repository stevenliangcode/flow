// Bundles the Electron main and preload scripts (TypeScript) into dist-electron/.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  await (await context(options)).watch();
} else {
  await build(options);
}
