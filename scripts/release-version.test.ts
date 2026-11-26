import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkReleaseTag, readRepoVersions, validateRelease, type RepoVersions } from './release-version'

const aligned: RepoVersions = { tauriConf: '0.1.0', cargoToml: '0.1.0', packageJson: '0.1.0' }

describe('checkReleaseTag', () => {
  it('acepta un tag vX.Y.Z que coincide con las tres versiones', () => {
    expect(checkReleaseTag('v0.1.0', aligned)).toEqual({ ok: true, version: '0.1.0' })
  })

  it.each(['0.1.0', 'v0.1', 'v0.1.0.1', 'v01.1.0', 'v0.1.0-rc.1', 'v0.1.0+build', 'V0.1.0', 'v0.1.0 ', '', 'refs/tags/v0.1.0'])(
    'rechaza el tag con formato invalido %j',
    (tag) => {
      expect(checkReleaseTag(tag, aligned).ok).toBe(false)
    },
  )

  it('rechaza un prerelease aunque las tres versiones lo repitan', () => {
    const prerelease = { tauriConf: '0.1.0-rc.1', cargoToml: '0.1.0-rc.1', packageJson: '0.1.0-rc.1' }
    expect(checkReleaseTag('v0.1.0-rc.1', prerelease).ok).toBe(false)
  })

  it('rechaza un tag distinto de las versiones', () => {
    const result = checkReleaseTag('v0.2.0', aligned)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.join(' ')).toContain('0.1.0')
  })

  it.each([
    ['tauriConf', { ...aligned, tauriConf: '0.0.9' }],
    ['cargoToml', { ...aligned, cargoToml: '0.0.9' }],
    ['packageJson', { ...aligned, packageJson: '0.0.9' }],
  ])('rechaza cuando %s no coincide', (field, versions) => {
    const result = checkReleaseTag('v0.1.0', versions)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.join(' ')).toContain(field)
  })

  it('informa todas las discrepancias a la vez', () => {
    const result = checkReleaseTag('v0.1.0', { tauriConf: '1.0.0', cargoToml: '2.0.0', packageJson: '0.1.0' })
    expect(result.ok === false && result.errors).toHaveLength(2)
  })
})

describe('readRepoVersions', () => {
  function makeRepo(files: { conf?: string; cargo?: string; pkg?: string }): string {
    const root = mkdtempSync(join(tmpdir(), 'release-version-'))
    mkdirSync(join(root, 'src-tauri'))
    if (files.conf !== undefined) writeFileSync(join(root, 'src-tauri/tauri.conf.json'), files.conf)
    if (files.cargo !== undefined) writeFileSync(join(root, 'src-tauri/Cargo.toml'), files.cargo)
    if (files.pkg !== undefined) writeFileSync(join(root, 'package.json'), files.pkg)
    return root
  }

  it('lee las tres versiones', () => {
    const root = makeRepo({
      conf: '{"version":"1.2.3"}',
      cargo: '[package]\nname = "x"\nversion = "1.2.4"\n\n[dependencies]\nfoo = { version = "9.9.9" }\n',
      pkg: '{"version":"1.2.5"}',
    })
    expect(readRepoVersions(root)).toEqual({ tauriConf: '1.2.3', cargoToml: '1.2.4', packageJson: '1.2.5' })
  })

  it('falla si falta un archivo', () => {
    const root = makeRepo({ conf: '{"version":"1.2.3"}', pkg: '{"version":"1.2.3"}' })
    expect(() => readRepoVersions(root)).toThrow()
  })

  it('falla si el Cargo.toml no declara version de paquete', () => {
    const root = makeRepo({ conf: '{"version":"1.0.0"}', cargo: '[package]\nname = "x"\n', pkg: '{"version":"1.0.0"}' })
    expect(() => readRepoVersions(root)).toThrow(/Cargo\.toml/)
  })

  it('falla si el JSON no tiene version textual', () => {
    const root = makeRepo({ conf: '{"version":1}', cargo: '[package]\nversion = "1.0.0"\n', pkg: '{"version":"1.0.0"}' })
    expect(() => readRepoVersions(root)).toThrow(/tauri\.conf\.json/)
  })
})

describe('validateRelease sobre el repo real', () => {
  it('acepta el tag derivado de las versiones del repo y rechaza otro', () => {
    const { packageJson } = readRepoVersions(process.cwd())
    expect(validateRelease(`v${packageJson}`, process.cwd()).ok).toBe(true)
    expect(validateRelease('v9.9.9', process.cwd()).ok).toBe(false)
  })
})
