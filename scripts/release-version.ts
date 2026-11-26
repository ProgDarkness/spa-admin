import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RepoVersions {
  tauriConf: string
  cargoToml: string
  packageJson: string
}

export type ReleaseCheck = { ok: true; version: string } | { ok: false; errors: string[] }

const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const CARGO_PACKAGE_VERSION_PATTERN = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms

function readJsonVersion(path: string): string {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const version = (parsed as { version?: unknown } | null)?.version
  if (typeof version !== 'string') throw new Error(`${path} no declara version textual`)
  return version
}

function readCargoVersion(path: string): string {
  const version = CARGO_PACKAGE_VERSION_PATTERN.exec(readFileSync(path, 'utf8'))?.[1]
  if (version === undefined) throw new Error(`${path} no declara version de paquete`)
  return version
}

export function readRepoVersions(root: string): RepoVersions {
  return {
    tauriConf: readJsonVersion(join(root, 'src-tauri', 'tauri.conf.json')),
    cargoToml: readCargoVersion(join(root, 'src-tauri', 'Cargo.toml')),
    packageJson: readJsonVersion(join(root, 'package.json')),
  }
}

export function checkReleaseTag(tag: string, versions: RepoVersions): ReleaseCheck {
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    return { ok: false, errors: [`el tag ${JSON.stringify(tag)} no tiene formato vX.Y.Z`] }
  }
  const version = tag.slice(1)
  const errors = (Object.entries(versions) as [keyof RepoVersions, string][])
    .filter(([, declared]) => declared !== version)
    .map(([field, declared]) => `${field} declara ${declared} y el tag pide ${version}`)
  return errors.length === 0 ? { ok: true, version } : { ok: false, errors }
}

export function validateRelease(tag: string, root: string): ReleaseCheck {
  return checkReleaseTag(tag, readRepoVersions(root))
}
