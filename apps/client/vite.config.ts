import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@aerial-arena/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@aerial-arena/game-core': path.resolve(__dirname, '../../packages/game-core/src/index.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'esnext',
  },
});
