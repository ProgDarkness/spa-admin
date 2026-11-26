import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readRepoVersions } from './release-version'

const EXPECTED_VERSION = '0.1.0'

function readBundle(): Record<string, unknown> {
  return JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).bundle
}

describe('empaquetado', () => {
  it('las tres versiones coinciden y valen 0.1.0', () => {
    expect(readRepoVersions(process.cwd())).toEqual({
      tauriConf: EXPECTED_VERSION,
      cargoToml: EXPECTED_VERSION,
      packageJson: EXPECTED_VERSION,
    })
  })

  it('bundle.targets es exactamente nsis, msi y dmg', () => {
    expect(readBundle().targets).toEqual(['nsis', 'msi', 'dmg'])
  })

  it('el instalador de Windows es por usuario y descarga WebView2', () => {
    expect(readBundle()).toMatchObject({
      windows: { nsis: { installMode: 'currentUser' }, webviewInstallMode: { type: 'downloadBootstrapper' } },
    })
  })

  it('macOS firma ad-hoc y se declara editor y categoria', () => {
    const bundle = readBundle()
    expect(bundle).toMatchObject({ macOS: { signingIdentity: '-' }, category: 'Business' })
    expect(String(bundle.publisher).length).toBeGreaterThan(0)
  })
})
