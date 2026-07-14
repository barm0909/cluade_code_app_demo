import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // launch.json の autoPort が割り当てるポート (PORT 環境変数) を優先する
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    // /api は wrangler dev (npm run dev:api, ローカルD1 に接続した Worker) へ中継する
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**'],
    },
  },
})
