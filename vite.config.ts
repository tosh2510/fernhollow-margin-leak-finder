import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'app',
  base: './',
  plugins: [react(), viteSingleFile()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 10000 },
});
