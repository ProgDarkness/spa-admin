import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI_PATH = resolve(__dirname, 'check-bundle-cli.ts')
const CLEAN_BUNDLE: Readonly<Record<string, string>> = {
  'index.html': 'limpio',
  '_next/static/chunks/app.js': 'export const x = 1',
}

let createdDirectories: string[]

beforeEach(() => {
  createdDirectories = []
})

afterEach(() => createdDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function createBundle(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), 'bundle-cli-'))
  createdDirectories.push(directory)
  Object.entries(files).forEach(([relativePath, content]) => {
    mkdirSync(dirname(join(directory, relativePath)), { recursive: true })
    writeFileSync(join(directory, relativePath), content)
  })
  return directory
}

function runCli(args: string[], cwd?: string) {
  return spawnSync('bun', [CLI_PATH, ...args], { encoding: 'utf8', ...(cwd ? { cwd } : {}) })
}

describe('check-bundle-cli', () => {
  it('sale con 0 en un bundle completo y limpio', () => {
    expect(runCli([createBundle(CLEAN_BUNDLE)]).status).toBe(0)
  })

  it('sale con 1 y nombra archivo y marcador si aparece uno', () => {
    const directory = createBundle({ ...CLEAN_BUNDLE, '_next/static/chunks/leak.js': 'createCatalogIpcBackend' })

    const outcome = runCli([directory])

    expect(outcome.status).toBe(1)
    expect(outcome.stderr).toContain('createCatalogIpcBackend')
    expect(outcome.stderr).toContain('leak.js')
  })

  it('sale con 1 y nombra por stderr los centinelas del seed', () => {
    const directory = createBundle({ ...CLEAN_BUNDLE, '_next/static/chunks/seed.js': 'a="Cabina 1";b="Manicure (Rosa)"' })

    const outcome = runCli([directory])

    expect(outcome.status).toBe(1)
    expect(outcome.stderr).toContain('Cabina 1')
    expect(outcome.stderr).toContain('Manicure (Rosa)')
    expect(outcome.stderr).toContain('seed.js')
    expect(outcome.stdout).toBe('')
  })

  it('no emite aviso en un bundle limpio', () => {
    expect(runCli([createBundle(CLEAN_BUNDLE)]).stdout).toBe('')
  })

  it('sale con 1 si el directorio no existe', () => {
    expect(runCli([join(createBundle({}), 'ausente')]).status).toBe(1)
  })

  it('usa out como directorio por defecto', () => {
    const directory = createBundle({
      'out/index.html': 'x',
      'out/_next/static/chunks/leak.js': '__spaInvoke',
    })

    const outcome = runCli([], directory)

    expect(outcome.status).toBe(1)
    expect(outcome.stderr).toContain('__spaInvoke')
  })

  describe('falla cerrado ante un bundle incompleto', () => {
    it('sale con 1 y mensaje claro si el directorio está vacío', () => {
      const outcome = runCli([createBundle({})])

      expect(outcome.status).toBe(1)
      expect(outcome.stderr).toContain('no contiene archivos')
    })

    it('sale con 1 si solo hay directorios', () => {
      const directory = createBundle({})
      mkdirSync(join(directory, '_next', 'static', 'chunks'), { recursive: true })

      const outcome = runCli([directory])

      expect(outcome.status).toBe(1)
      expect(outcome.stderr).toContain('no contiene archivos')
    })

    it('sale con 1 si falta index.html en la raíz', () => {
      const outcome = runCli([createBundle({ '_next/static/chunks/app.js': 'x', 'sub/index.html': 'x' })])

      expect(outcome.status).toBe(1)
      expect(outcome.stderr).toContain('index.html')
    })

    it('sale con 1 si no hay ningún .js bajo _next/static', () => {
      const outcome = runCli([createBundle({ 'index.html': 'x', '_next/static/css/app.css': 'x', 'app.js': 'x' })])

      expect(outcome.status).toBe(1)
      expect(outcome.stderr).toContain('_next/static')
    })
  })
})
