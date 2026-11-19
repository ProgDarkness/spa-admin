import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const outDir = join(process.cwd(), 'out')
const isCi = Boolean(process.env.CI)
const DEMO_PASSWORD = ['demo', '1234'].join('')
const DEV_ONLY_MARKERS = ['IPC no simulado', 'dev-browser-ipc']

function collectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? collectFiles(join(directory, entry.name)) : [join(directory, entry.name)],
  )
}

describe.skipIf(!existsSync(outDir) && !isCi)('salida estática de next build (output: export)', () => {
  test.each(['index.html', 'login/index.html'])('genera out/%s', (file) => {
    expect(existsSync(join(outDir, file))).toBe(true)
  })

  test('genera out/icon.svg y index.html lo referencia', () => {
    expect(existsSync(join(outDir, 'icon.svg'))).toBe(true)
    expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain('icon.svg')
  })

  test('el fallback de desarrollo en navegador no se incluye en el build exportado', () => {
    const outputs = collectFiles(outDir).filter((file) => /\.(js|html)$/.test(file))

    const leaking = outputs.filter((file) =>
      DEV_ONLY_MARKERS.some((marker) => readFileSync(file, 'utf8').includes(marker)),
    )

    expect(outputs.length).toBeGreaterThan(0)
    expect(leaking).toEqual([])
  })

  test('el build exportado no contiene contraseñas de demostración', () => {
    const outputs = collectFiles(outDir).filter((file) => /\.(js|html|txt)$/.test(file))

    const leaking = outputs.filter((file) => readFileSync(file, 'utf8').includes(DEMO_PASSWORD))

    expect(outputs.length).toBeGreaterThan(0)
    expect(leaking).toEqual([])
  })
})
