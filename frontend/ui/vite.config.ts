import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend API port. Follows the same PORT env var the backend uses so the
// proxy stays in sync when the backend runs on a non-default port
// (turbo.json passes PORT through to the dev task; see README).
const backendPort = process.env.PORT ?? '3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
