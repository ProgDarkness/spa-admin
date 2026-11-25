import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEV_BROWSER_IPC_SENTINEL } from '@/test/ipc/dev-browser-ipc'
import {
  findForbiddenMarkers,
  findSeedSentinels,
  FORBIDDEN_BUNDLE_MARKERS,
  LITERAL_MARKER_SOURCES,
  resolveExitCode,
  SEED_SENTINEL_MARKERS,
  SEED_SENTINELS_BLOCK_BUNDLE,
} from './check-bundle'

const REPOSITORY_ROOT = resolve(__dirname, '..')
const DEV_IPC_SOURCE = 'src/test/ipc/dev-browser-ipc.ts'

let outputDirectory: string
let entryDirectory: string

beforeEach(() => {
  outputDirectory = mkdtempSync(join(tmpdir(), 'bundle-markers-'))
  entryDirectory = mkdtempSync(join(tmpdir(), 'bundle-entry-'))
})

afterEach(() => {
  rmSync(outputDirectory, { recursive: true, force: true })
  rmSync(entryDirectory, { recursive: true, force: true })
})

function minifyDevIpcModule(): void {
  const entryPath = join(entryDirectory, 'entry.ts')
  writeFileSync(entryPath, `export { installDevBrowserIpc } from ${JSON.stringify(resolve(REPOSITORY_ROOT, DEV_IPC_SOURCE))}\n`)
  const outcome = spawnSync(
    'bun',
    [
      'build',
      entryPath,
      '--minify',
      '--target=browser',
      '--define',
      'process.env.NODE_ENV="development"',
      '--outdir',
      outputDirectory,
    ],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  )
  expect(outcome.status, outcome.stderr).toBe(0)
}

describe('marcadores literales del bundle', () => {
  it('incluye el centinela real del IPC de desarrollo', () => {
    expect(FORBIDDEN_BUNDLE_MARKERS).toContain(DEV_BROWSER_IPC_SENTINEL)
  })

  it('incluye el mensaje de error del import dinámico de providers', () => {
    expect(FORBIDDEN_BUNDLE_MARKERS).toContain('No se pudo instalar el IPC de desarrollo')
  })

  it.each([
    'createCatalogIpcBackend',
    'createResourcesIpcBackend',
    'createPaymentMethodsIpcBackend',
    'createRatesIpcBackend',
    'createClientsIpcBackend',
    'createDevBackends',
    'composeBackends',
    'createAuthIpcBackend',
  ])(
    'incluye el identificador %s de los backends simulados',
    (identifier) => {
      expect(FORBIDDEN_BUNDLE_MARKERS).toContain(identifier)
    },
  )

  it.each(LITERAL_MARKER_SOURCES)('el literal $marker sigue presente en $source', ({ marker, source }) => {
    const content = readFileSync(resolve(REPOSITORY_ROOT, source), 'utf8')

    expect(content).toContain(`'${marker}'`)
  })

  it('el centinela sobrevive a la minificación del código real y se detecta', () => {
    minifyDevIpcModule()

    const markers = findForbiddenMarkers(outputDirectory).map((hit) => hit.marker)

    expect(markers).toContain(DEV_BROWSER_IPC_SENTINEL)
  })
})

describe('centinelas del seed (informativos)', () => {
  const SEED_SENTINELS = ['Manicure (Rosa)', '(ejemplo)', 'Cabina 1', 'createSeed', 'V-26789012']

  it.each(SEED_SENTINELS)('incluye el centinela %s', (sentinel) => {
    expect(SEED_SENTINEL_MARKERS).toContain(sentinel)
  })

  it('no mezcla los centinelas del seed con los marcadores prohibidos', () => {
    SEED_SENTINELS.forEach((sentinel) => expect(FORBIDDEN_BUNDLE_MARKERS).not.toContain(sentinel))
  })

  it('no bloquea el bundle por ahora', () => {
    expect(SEED_SENTINELS_BLOCK_BUNDLE).toBe(false)
  })

  it('detecta un centinela en un archivo del bundle', () => {
    writeFileSync(join(outputDirectory, 'chunk.js'), 'x="Cabina 1";y=1')

    expect(findSeedSentinels(outputDirectory)).toEqual([{ file: 'chunk.js', marker: 'Cabina 1' }])
  })

  it('detecta la cédula del cliente eliminado del seed', () => {
    writeFileSync(join(outputDirectory, 'chunk.js'), 'x="V-26789012"')

    expect(findSeedSentinels(outputDirectory)).toEqual([{ file: 'chunk.js', marker: 'V-26789012' }])
  })

  it('no reporta nada en un bundle limpio', () => {
    writeFileSync(join(outputDirectory, 'chunk.js'), 'x=1')

    expect(findSeedSentinels(outputDirectory)).toEqual([])
  })

  it('findForbiddenMarkers ignora los centinelas del seed', () => {
    writeFileSync(join(outputDirectory, 'chunk.js'), 'createSeed (ejemplo)')

    expect(findForbiddenMarkers(outputDirectory)).toEqual([])
  })

  describe('resolveExitCode', () => {
    const forbidden = [{ file: 'a.js', marker: 'mockIPC' }]
    const seed = [{ file: 'b.js', marker: 'createSeed' }]

    it('ignora el seed cuando no es bloqueante', () => {
      expect(resolveExitCode({ forbiddenHits: [], seedHits: seed, seedBlocking: false })).toBe(0)
    })

    it('falla por el seed cuando es bloqueante', () => {
      expect(resolveExitCode({ forbiddenHits: [], seedHits: seed, seedBlocking: true })).toBe(1)
    })

    it('pasa con el seed bloqueante si no hay hits', () => {
      expect(resolveExitCode({ forbiddenHits: [], seedHits: [], seedBlocking: true })).toBe(0)
    })

    it('los marcadores prohibidos siempre fallan', () => {
      expect(resolveExitCode({ forbiddenHits: forbidden, seedHits: [], seedBlocking: false })).toBe(1)
    })
  })
})
