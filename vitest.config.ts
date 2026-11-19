import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    env: { TZ: 'America/Caracas' },
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    typecheck: { enabled: true, include: ['src/**/*.test-d.ts'] },
    coverage: {
      provider: 'v8',
      include: ['src/features/**', 'src/lib/**', 'src/components/app-shell.tsx'],
      exclude: ['src/components/ui/**', 'src/lib/mock/seed.ts', 'src/test/**', '**/*.test.*', 'src/lib/bindings.ts'],
      thresholds: { lines: 80 },
    },
  },
})
