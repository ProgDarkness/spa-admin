import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findRuntimeSeedImports } from './seed-import-guard'

const SOURCE_ROOT = join(process.cwd(), 'src')
const SOURCE_EXTENSIONS = ['.ts', '.tsx']
const TEST_DIRECTORY = `test${sep}`
const SEED_MODULE_PREFIX = join('lib', 'mock', 'seed')

function isProductionSource(relativePath: string): boolean {
  if (!SOURCE_EXTENSIONS.some((extension) => relativePath.endsWith(extension))) return false
  if (/\.test(-d)?\.tsx?$/.test(relativePath)) return false
  if (relativePath.startsWith(TEST_DIRECTORY)) return false
  return !relativePath.startsWith(SEED_MODULE_PREFIX)
}

function productionSources(): string[] {
  return readdirSync(SOURCE_ROOT, { recursive: true, encoding: 'utf8' }).filter(isProductionSource)
}

describe('grafo de importaciones de producción', () => {
  it('recorre el código de producción', () => {
    const sources = productionSources()

    expect(sources.length).toBeGreaterThan(50)
    expect(sources).toContain(join('lib', 'mock', 'store.ts'))
    expect(sources).not.toContain(join('lib', 'mock', 'seed.ts'))
  })

  it('ningún archivo de producción importa el seed por ninguna ruta', () => {
    const offenders = productionSources().flatMap((file) =>
      findRuntimeSeedImports(readFileSync(join(SOURCE_ROOT, file), 'utf8')).map((specifier) => `${relative(process.cwd(), join(SOURCE_ROOT, file))} -> ${specifier}`),
    )

    expect(offenders).toEqual([])
  })
})
