import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // O7 FIX: Stable filenames — prevents hash mismatch with ChatViewProvider.ts
        entryFileNames: 'assets/index.js',
        assetFileNames: 'assets/index.[ext]',
        // P2 FIX: Code splitting to reduce main bundle below 500KB warning
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-icons': ['lucide-react'],
          'vendor-state': ['zustand', 'i18next', 'react-i18next'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:51122',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:51122',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
