import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const mockImportPatterns = [
  {
    group: ['@/lib/mock', '@/lib/mock/**', '**/mock', '**/mock/**', './mock', './mock/**'],
    message: 'El mock solo se importa desde src/features/*/api.ts, tests y src/test/**',
  },
]

const eslintConfig = [
  { ignores: ['.next/**', 'out/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**', 'src-tauri/**', 'src/lib/bindings.ts'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      'no-restricted-imports': ['error', { patterns: mockImportPatterns }],
    },
  },
  {
    files: ['e2e/**', 'src/features/*/api.ts', '**/*.test.ts', '**/*.test.tsx', 'src/test/**', 'src/lib/mock/**', 'vitest.setup.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
]

export default eslintConfig
