import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEV_BROWSER_IPC_SENTINEL } from '@/test/ipc/dev-browser-ipc'
import { findForbiddenMarkers, FORBIDDEN_BUNDLE_MARKERS, LITERAL_MARKER_SOURCES } from './check-bundle'

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
