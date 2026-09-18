import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@ink/shared': path.resolve(__dirname, './shared/src'),
      '@ink/server': path.resolve(__dirname, './server/src')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
