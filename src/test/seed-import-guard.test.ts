import { describe, expect, it } from 'vitest'
import { findRuntimeSeedImports } from './seed-import-guard'

describe('findRuntimeSeedImports', () => {
  it.each([
    ["import { createSeed } from './seed'", './seed'],
    ["import { createSeed } from '@/lib/mock/seed'", '@/lib/mock/seed'],
    ["import * as seed from '@/lib/mock/seed'", '@/lib/mock/seed'],
    ["import seed from '../mock/seed'", '../mock/seed'],
    ["import '@/lib/mock/seed'", '@/lib/mock/seed'],
    ["import { type MockUser, createSeed } from './seed'", './seed'],
    ["import { type MockUser } from './seed'", './seed'],
    ["export { createSeed } from './seed'", './seed'],
    ["export * from '@/lib/mock/seed'", '@/lib/mock/seed'],
    ["const seed = await import('@/lib/mock/seed')", '@/lib/mock/seed'],
    ['const seed = await import("./seed.ts")', './seed.ts'],
    ["const seed = require('./seed')", './seed'],
    ["import {\n  createSeed,\n  type MockUser,\n} from './seed'", './seed'],
  ])('detecta %j', (source, specifier) => {
    expect(findRuntimeSeedImports(source)).toEqual([specifier])
  })

  it.each([
    "import type { MockUser } from './seed'",
    "import type { MockUser } from '@/lib/mock/seed'",
    "export type { MockUser } from './seed'",
    "import { seedFormatter } from './seed-format'",
    "import { x } from './reseed'",
    "const text = 'seed'",
    '',
  ])('ignora %j', (source) => {
    expect(findRuntimeSeedImports(source)).toEqual([])
  })

  it('reporta cada importación del seed de un mismo archivo', () => {
    const source = "import type { A } from './seed'\nimport { b } from './seed'\nconst c = import('@/lib/mock/seed')"

    expect(findRuntimeSeedImports(source)).toEqual(['./seed', '@/lib/mock/seed'])
  })
})
