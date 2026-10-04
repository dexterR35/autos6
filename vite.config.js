import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import seoPlugin from './vite/seoPlugin.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), seoPlugin(env)],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: false },
      },
    },
    test: {
      environment: 'node',
      setupFiles: ['./tests/setup.js'],
      include: ['tests/**/*.test.{js,jsx}'],
      testTimeout: 20000,
    },
  };
});
