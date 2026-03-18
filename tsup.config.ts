import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    manifest: 'src/plugin/manifest.ts',
    'plugin/worker': 'src/plugin/worker.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: true,
  splitting: true,
  external: [
    '@paperclipai/shared',
    'execa',
    'js-yaml',
    'pino',
    'zod',
  ],
});
