/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Served by webuddy-server from tools/webuddy-server/public.
    outDir: '../public',
    emptyOutDir: true
  },
  server: {
    proxy: { '/api': process.env.WEBUDDY_API ?? 'http://127.0.0.1:8787' }
  },
  test: {
    environment: 'jsdom',
    // Tests must be *.test.tsx: bare `node --test` in the server dir would also run *.test.ts files.
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/vitest-setup.ts']
  }
})
