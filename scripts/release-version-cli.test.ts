import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { readRepoVersions } from './release-version'

function runCli(args: string[]) {
  return spawnSync('bun', ['scripts/release-version-cli.ts', ...args], { cwd: process.cwd(), encoding: 'utf8' })
}

describe('release-version-cli', () => {
  it('sale con 0 y escribe la version para el tag correcto', () => {
    const { packageJson } = readRepoVersions(process.cwd())
    const result = runCli([`v${packageJson}`])
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(packageJson)
  })

  it('sale con 1 y explica el motivo para un tag que no coincide', () => {
    const result = runCli(['v9.9.9'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('9.9.9')
  })

  it('sale con 1 sin argumento', () => {
    expect(runCli([]).status).toBe(1)
  })
})
