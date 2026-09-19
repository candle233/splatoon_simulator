import { defineConfig } from 'vite';
import path from 'path';

// Port 5273: the default 5173 falls inside Windows WinNAT reserved port ranges
// (5083-5182 on many machines), which makes listen() fail with EACCES.
// The client always connects to its own origin, so any port works.
export default defineConfig({
  resolve: {
    alias: {
      '@ink/shared': path.resolve(__dirname, '../shared/src')
    }
  },
  server: {
    port: 5273,
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  }
});
