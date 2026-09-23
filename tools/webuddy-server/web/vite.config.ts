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
    // Only .test.tsx: the server's bare `node --test` also discovers *.test.ts and test/ dirs here.
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/vitest-setup.ts']
  }
})
