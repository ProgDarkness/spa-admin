import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const IDENTIFIER_MARKERS: readonly string[] = [
  'mockIPC',
  'createCatalogIpcBackend',
  'createResourcesIpcBackend',
  'createPaymentMethodsIpcBackend',
  'createRatesIpcBackend',
  'createClientsIpcBackend',
  'createAppointmentsIpcBackend',
  'createPaymentsIpcBackend',
  'createClientHistoryIpcBackend',
  'createDevBackends',
  'composeBackends',
  'createAuthIpcBackend',
  'installDevBrowserIpc',
  '__spaInvoke',
]

export type LiteralMarkerSource = { marker: string; source: string }

export const LITERAL_MARKER_SOURCES: readonly LiteralMarkerSource[] = [
  { marker: 'spa-dev-browser-ipc/6f2c9a1e', source: 'src/test/ipc/dev-browser-ipc.ts' },
  { marker: 'No se pudo instalar el IPC de desarrollo', source: 'src/app/providers.tsx' },
]

export const FORBIDDEN_BUNDLE_MARKERS: readonly string[] = [
  ...LITERAL_MARKER_SOURCES.map(({ marker }) => marker),
  ...IDENTIFIER_MARKERS,
]

export const SEED_SENTINEL_MARKERS: readonly string[] = ['Manicure (Rosa)', '(ejemplo)', 'Cabina 1', 'createSeed', 'V-26789012', 'Cita seed inexistente', '0414-1234567', 'E-81234567', 'V-14567890']

export const SEED_SENTINELS_BLOCK_BUNDLE = true

export const MAX_BUNDLE_FILE_BYTES = 50 * 1024 * 1024

const STATIC_ASSETS_PREFIX = join('_next', 'static') + sep

export type ForbiddenMarkerHit = { file: string; marker: string }
export type BundleScanOptions = { maxFileBytes?: number }

function resolveInside(root: string, linkPath: string): string {
  let target: string
  try {
    target = realpathSync(linkPath)
  } catch {
    throw new Error(`enlace simbólico roto: ${linkPath}`)
  }
  if (!target.startsWith(root + sep)) throw new Error(`enlace simbólico fuera del directorio: ${linkPath}`)
  return target
}

function isRegularFile(root: string, path: string): boolean {
  const entry = lstatSync(path)
  return (entry.isSymbolicLink() ? statSync(resolveInside(root, path)) : entry).isFile()
}

function listBundleFiles(directory: string): string[] {
  const root = realpathSync(directory)
  return readdirSync(directory, { recursive: true, encoding: 'utf8' }).filter((entry) =>
    isRegularFile(root, join(directory, entry)),
  )
}

export function assertCompleteBundle(directory: string): void {
  const files = listBundleFiles(directory)
  if (files.length === 0) throw new Error('el bundle no contiene archivos')
  if (!files.includes('index.html')) throw new Error('falta index.html en la raíz del bundle')
  if (!files.some((file) => file.startsWith(STATIC_ASSETS_PREFIX) && file.endsWith('.js'))) {
    throw new Error('falta algún .js bajo _next/static')
  }
}

function findMarkers(
  directory: string,
  markers: readonly string[],
  { maxFileBytes = MAX_BUNDLE_FILE_BYTES }: BundleScanOptions,
): ForbiddenMarkerHit[] {
  return listBundleFiles(directory).flatMap((file) => {
    const path = join(directory, file)
    if (statSync(path).size > maxFileBytes) throw new Error(`${file} supera el tope de ${maxFileBytes} bytes`)
    const content = readFileSync(path, 'latin1')
    return markers.filter((marker) => content.includes(marker)).map((marker) => ({ file, marker }))
  })
}

export function findForbiddenMarkers(directory: string, options: BundleScanOptions = {}): ForbiddenMarkerHit[] {
  return findMarkers(directory, FORBIDDEN_BUNDLE_MARKERS, options)
}

export function findSeedSentinels(directory: string, options: BundleScanOptions = {}): ForbiddenMarkerHit[] {
  return findMarkers(directory, SEED_SENTINEL_MARKERS, options)
}

export type ExitCodeInput = {
  forbiddenHits: readonly ForbiddenMarkerHit[]
  seedHits: readonly ForbiddenMarkerHit[]
  seedBlocking: boolean
}

export function resolveExitCode({ forbiddenHits, seedHits, seedBlocking }: ExitCodeInput): number {
  const blockingSeedHits = seedBlocking ? seedHits : []
  return forbiddenHits.length + blockingSeedHits.length === 0 ? 0 : 1
}
