import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const IDENTIFIER_MARKERS: readonly string[] = [
  'mockIPC',
  'createCatalogIpcBackend',
  'createResourcesIpcBackend',
  'createPaymentMethodsIpcBackend',
  'createRatesIpcBackend',
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

export function findForbiddenMarkers(
  directory: string,
  { maxFileBytes = MAX_BUNDLE_FILE_BYTES }: BundleScanOptions = {},
): ForbiddenMarkerHit[] {
  return listBundleFiles(directory).flatMap((file) => {
    const path = join(directory, file)
    if (statSync(path).size > maxFileBytes) throw new Error(`${file} supera el tope de ${maxFileBytes} bytes`)
    const content = readFileSync(path, 'latin1')
    return FORBIDDEN_BUNDLE_MARKERS.filter((marker) => content.includes(marker)).map((marker) => ({ file, marker }))
  })
}
