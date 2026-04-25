import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-dom/client': path.resolve(__dirname, 'node_modules/react-dom/client.js'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 10000,
    include: ['src/**/*.test.ts', 'ui/src/**/*.test.ts', 'ui/src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
  },
});
