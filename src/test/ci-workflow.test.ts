import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  id?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
  if?: string
}
interface Job {
  'runs-on': string
  if?: string
  steps: Step[]
  strategy?: { matrix: { os: string[] } }
}
interface Trigger {
  branches?: string[]
}
interface Workflow {
  on: { push?: Trigger; pull_request?: unknown }
  permissions: Record<string, string>
  concurrency: Record<string, unknown>
  jobs: Record<string, Job>
}

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml')
const raw = readFileSync(workflowPath, 'utf8')
const workflow = parse(raw) as Workflow
const jobOf = (name: string): Job => {
  const job = workflow.jobs[name]
  if (!job) throw new Error(`missing job ${name}`)
  return job
}
const runs = (job: Job) => job.steps.map((s) => s.run ?? '')
const indexOfRun = (job: Job, fragment: string) =>
  runs(job).findIndex((r) => r.includes(fragment))
const stepIndex = (job: Job, predicate: (s: Step) => boolean) => job.steps.findIndex(predicate)
const bunVersion = '1.4.2'
const llvmCovVersion = '0.9.1'
const cargoDenyVersion = '0.20.2'
const installActionPrefix = 'taiki-e/install-action@'
const denyToml = readFileSync(resolve(process.cwd(), 'src-tauri/deny.toml'), 'utf8')
const cargoCommand = /\bcargo\b|tauri build/

describe('ci workflow', () => {
  it('declares least-privilege permissions at workflow level', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('cancels superseded runs', () => {
    expect(workflow.concurrency['cancel-in-progress']).toBe("${{ github.ref != 'refs/heads/main' }}")
    expect(String(workflow.concurrency.group)).toContain('github.ref')
  })

  it('triggers pushes only on main', () => {
    expect(workflow.on.push?.branches).toEqual(['main'])
    expect(workflow.on).toHaveProperty('pull_request')
  })

  it('does not persist checkout credentials', () => {
    const checkouts = Object.values(workflow.jobs)
      .flatMap((j) => j.steps)
      .filter((s) => s.uses?.startsWith('actions/checkout@'))
    expect(checkouts.length).toBe(Object.keys(workflow.jobs).length)
    for (const c of checkouts) expect(c.with?.['persist-credentials']).toBe(false)
  })

  it('pins bun and uses --locked for every cargo test, clippy, llvm-cov and tauri build', () => {
    const setups = Object.values(workflow.jobs)
      .flatMap((j) => j.steps)
      .filter((s) => s.uses?.startsWith('oven-sh/setup-bun@'))
    expect(setups.length).toBe(Object.keys(workflow.jobs).length)
    for (const s of setups) expect(String(s.with?.['bun-version'])).toBe(bunVersion)
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      packageManager: string
    }
    expect(pkg.packageManager).toBe(`bun@${bunVersion}`)
    const lines = raw
      .split('\n')
      .filter((l) => /cargo (test|clippy|llvm-cov|build)/.test(l) || /tauri build/.test(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).toContain('--locked')
  })

  it('never references secrets', () => {
    expect(raw).not.toMatch(/secrets\./)
  })

  it('has no comments', () => {
    const lines = raw.split('\n')
    expect(lines.some((l) => l.trimStart().startsWith('#'))).toBe(false)
    expect(lines.some((l) => /\s#\s/.test(l) && !/\$\{#|\$#/.test(l))).toBe(false)
    const scripts = Object.values(workflow.jobs)
      .flatMap((j) => runs(j))
      .join('\n')
      .split('\n')
    expect(scripts.some((l) => /(^|\s)#(\s|$)/.test(l.trim()) || l.trimStart().startsWith('#'))).toBe(false)
  })

  it('pins every action to a 40-hex commit sha', () => {
    const uses = Object.values(workflow.jobs)
      .flatMap((j) => j.steps)
      .map((s) => s.uses)
      .filter((u): u is string => Boolean(u))
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+(\/[\w.-]+)*@[0-9a-f]{40}$/)
  })

  it('uses bun only', () => {
    expect(raw).not.toMatch(/\b(npm|yarn|pnpm|npx)\b/)
  })

  describe('web job', () => {
    const job = jobOf('web')
    it('runs on ubuntu for every push and pull request', () => {
      expect(job['runs-on']).toBe('ubuntu-latest')
      expect(job.if).toBeUndefined()
      expect(Object.keys(workflow.on)).toEqual(expect.arrayContaining(['push', 'pull_request']))
    })
    it('runs the quality pipeline in order', () => {
      const order = [
        'bun install --frozen-lockfile',
        'bun run lint',
        'bun run typecheck',
        'bun run build',
        'bun run test:cov',
        'playwright install',
        'bun run e2e',
      ].map((f) => indexOfRun(job, f))
      expect(order.every((i) => i >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(job.steps.some((s) => s.uses?.startsWith('oven-sh/setup-bun@'))).toBe(true)
      expect(runs(job).join('\n')).toContain('chromium')
    })
  })

  describe('rust job', () => {
    const job = jobOf('rust')
    const steps = job.steps
    it('matrix is exactly windows, macos and ubuntu', () => {
      expect(job.strategy?.matrix.os).toEqual(['windows-latest', 'macos-latest', 'ubuntu-latest'])
      expect(job['runs-on']).toMatch(/matrix\.os/)
    })
    it('is gated to pull requests into main or pushes to main', () => {
      expect(job.if).toContain("github.event_name == 'pull_request'")
      expect(job.if).toContain('github.base_ref')
      expect(job.if).toContain("'main'")
      expect(job.if).toContain("github.ref == 'refs/heads/main'")
    })
    it('builds the frontend before any cargo command', () => {
      const build = indexOfRun(job, 'bun run build')
      const firstCargo = runs(job).findIndex((r) => cargoCommand.test(r))
      expect(build).toBeGreaterThan(-1)
      expect(build).toBeLessThan(firstCargo)
      expect(indexOfRun(job, 'bun install --frozen-lockfile')).toBeLessThan(build)
    })
    it('installs a pinned NASM on windows and verifies perl and nasm before any cargo command', () => {
      const install = stepIndex(job, (s) => /choco install nasm/.test(s.run ?? ''))
      const verify = stepIndex(job, (s) => /OPENSSL_SRC_PERL" -v/.test(s.run ?? '') && /nasm -v/.test(s.run ?? ''))
      const firstCargo = stepIndex(job, (s) => cargoCommand.test(s.run ?? ''))
      expect(install).toBeGreaterThan(-1)
      expect(steps[install]?.if).toContain('Windows')
      expect(steps[install]?.run).toMatch(/--version[= ]\d+\.\d+(\.\d+)?/)
      expect(steps[install]?.run).toContain('GITHUB_PATH')
      expect(steps[verify]?.if).toContain('Windows')
      expect(install).toBeLessThan(verify)
      expect(verify).toBeLessThan(firstCargo)
    })
    it('points openssl-src at Strawberry Perl on windows before any cargo command', () => {
      const configure = stepIndex(job, (s) => /OPENSSL_SRC_PERL/.test(s.run ?? ''))
      const verify = stepIndex(job, (s) => /Locale::Maketext::Simple/.test(s.run ?? ''))
      const firstCargo = stepIndex(job, (s) => cargoCommand.test(s.run ?? ''))
      expect(configure).toBeGreaterThan(-1)
      expect(steps[configure]?.if).toContain('Windows')
      const script = steps[configure]?.run ?? ''
      expect(script).toMatch(/OPENSSL_SRC_PERL=C:\/Strawberry\/perl\/bin\/perl\.exe[^\n]*GITHUB_ENV/)
      expect(script).toMatch(/Strawberry\\perl\\bin[^\n]*GITHUB_PATH/)
      expect(script).not.toMatch(/Strawberry\\c\\bin/)
      expect(configure).toBeLessThan(firstCargo)
      expect(verify).toBeGreaterThan(configure)
      expect(verify).toBeLessThan(firstCargo)
      expect(steps[verify]?.if).toContain('Windows')
      const check = steps[verify]?.run ?? ''
      expect(check).not.toMatch(/command -v perl/)
      expect(check).not.toMatch(/grep/)
      expect(check).toMatch(/test -x "\$OPENSSL_SRC_PERL"/)
      expect(check).toMatch(/"\$OPENSSL_SRC_PERL" -e "use Locale::Maketext::Simple; print 1"/)
      expect(check).toMatch(/"\$OPENSSL_SRC_PERL" -v/)
      expect(check).toMatch(/nasm -v/)
    })
    it('installs linux system libraries and a keyring daemon on ubuntu before any cargo command', () => {
      const apt = stepIndex(job, (s) => /apt-get install/.test(s.run ?? ''))
      const firstCargo = stepIndex(job, (s) => cargoCommand.test(s.run ?? ''))
      expect(apt).toBeGreaterThan(-1)
      expect(apt).toBeLessThan(firstCargo)
      expect(steps[apt]?.if).toContain('Linux')
      for (const pkg of [
        'libwebkit2gtk-4.1-dev',
        'libsecret-1-dev',
        'gnome-keyring',
        'dbus',
        'xvfb',
        'libssl-dev',
        'pkg-config',
        'build-essential',
      ])
        expect(steps[apt]?.run).toContain(pkg)
    })
    it('runs real-keyring tests under dbus-run-session and xvfb-run on linux only', () => {
      const linux = steps.find(
        (s) => /--features real-keyring/.test(s.run ?? '') && /dbus-run-session/.test(s.run ?? ''),
      )
      expect(linux?.run).toContain('xvfb-run')
      expect(linux?.run).toContain('gnome-keyring-daemon')
      expect(linux?.if).toContain('Linux')
      const others = steps.find(
        (s) => /--features real-keyring/.test(s.run ?? '') && !/dbus-run-session/.test(s.run ?? ''),
      )
      expect(others?.if).toMatch(/!=\s*'Linux'/)
    })
    it('pins rust 1.100 with clippy and rustfmt and caches cargo', () => {
      const tc = steps.find((s) => s.uses?.startsWith('dtolnay/rust-toolchain@'))
      expect(String(tc?.with?.toolchain)).toMatch(/^1\.100(\.0)?$/)
      expect(String(tc?.with?.components)).toContain('clippy')
      expect(String(tc?.with?.components)).toContain('rustfmt')
      expect(steps.some((s) => s.uses?.startsWith('Swatinem/rust-cache@'))).toBe(true)
      const toolchainFile = readFileSync(resolve(process.cwd(), 'src-tauri/rust-toolchain.toml'), 'utf8')
      expect(toolchainFile).toMatch(/channel\s*=\s*"1\.100\.0"/)
    })
    it('runs fmt, clippy, tests, bindings check, real-keyring and tauri build in order', () => {
      const order = [
        /cargo fmt .*--check/,
        /cargo clippy .*--all-targets -- -D warnings/,
        /cargo test(?!.*real-keyring)/,
        /git status --porcelain -- src\/lib\/bindings\.ts/,
        /cargo test .*--features real-keyring/,
        /tauri build --debug --no-bundle/,
      ].map((re) => runs(job).findIndex((r) => re.test(r)))
      expect(order.every((i) => i >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      const all = runs(job).join('\n')
      expect(all).not.toContain('git diff --exit-code')
      expect(all).toMatch(/\[ -n "\$\(git status --porcelain -- src\/lib\/bindings\.ts\)" \]/)
      expect(all).toContain('--check')
      expect(all).toMatch(/src-tauri\/Cargo\.toml|working-directory/)
    })
    it('forces LF line endings through a root .gitattributes', () => {
      const gitattributes = readFileSync(resolve(process.cwd(), '.gitattributes'), 'utf8')
      expect(gitattributes).toMatch(/^\*\s+text=auto\s+eol=lf\s*$/m)
    })
    it('prints bindings diagnostics before failing the bindings check', () => {
      const step = steps.find((s) => /git status --porcelain -- src\/lib\/bindings\.ts/.test(s.run ?? ''))
      const script = step?.run ?? ''
      const diagnostics = script.indexOf('git --no-pager diff --stat')
      const ignoreEol = script.indexOf('git --no-pager diff --ignore-space-at-eol')
      const exit = script.indexOf('exit 1')
      expect(diagnostics).toBeGreaterThanOrEqual(0)
      expect(ignoreEol).toBeGreaterThan(diagnostics)
      expect(exit).toBeGreaterThan(ignoreEol)
      expect(script).toContain('src/lib/bindings.ts')
    })
    it('runs the windows lib test binary verbosely after a failed cargo test to expose loader errors', () => {
      const test = stepIndex(job, (s) => /cargo test(?!.*real-keyring)/.test(s.run ?? ''))
      const diagnose = stepIndex(job, (s) => /spa_app_lib-\*\.exe/.test(s.run ?? ''))
      expect(diagnose).toBe(test + 1)
      const testId = steps[test]?.id
      expect(testId).toBeTruthy()
      expect(steps[diagnose]?.if).toContain('failure()')
      expect(steps[diagnose]?.if).toContain(`steps.${testId}.outcome == 'failure'`)
      expect(steps[diagnose]?.if).toContain('Windows')
      expect(steps[diagnose]?.run).toContain('--nocapture')
      expect(steps[diagnose]?.run).toContain('[ -e "$exe" ] || continue')
    })
    it('creates an unlocked temporary keychain on macos before real-keyring tests', () => {
      const keychain = stepIndex(job, (s) => /security create-keychain/.test(s.run ?? ''))
      const real = stepIndex(job, (s) => /--features real-keyring/.test(s.run ?? ''))
      expect(keychain).toBeGreaterThan(-1)
      expect(keychain).toBeLessThan(real)
      expect(steps[keychain]?.if).toContain('macOS')
      const script = steps[keychain]?.run ?? ''
      for (const cmd of [
        'security create-keychain',
        'security default-keychain -s',
        'security unlock-keychain',
        'security set-keychain-settings',
      ])
        expect(script).toContain(cmd)
      expect(script).toMatch(/openssl rand|uuidgen|\/dev\/urandom/)
      expect(script).not.toMatch(/create-keychain\s+(-p|--password)[=\s]+(?!["']?\$)/)
      expect(script).toMatch(/create-keychain\s+-p\s+"\$\{?[a-z_]+\}?"/)
    })
  })

  describe('core-coverage job', () => {
    const job = jobOf('core-coverage')
    it('runs on ubuntu with system libraries and llvm-cov at 80 percent lines', () => {
      expect(job['runs-on']).toBe('ubuntu-latest')
      const all = runs(job).join('\n')
      for (const pkg of [
        'libwebkit2gtk-4.1-dev',
        'libsecret-1-dev',
        'libayatana-appindicator3-dev',
        'librsvg2-dev',
        'build-essential',
        'pkg-config',
        'libssl-dev',
      ])
        expect(all).toContain(pkg)
      expect(all).toContain('cargo llvm-cov')
      expect(all).toContain('--fail-under-lines 80')
      expect(all).toContain('--ignore-filename-regex')
      expect(all).not.toMatch(/ignore-filename-regex[^\n]*features/)
      const regex = /--ignore-filename-regex '([^']+)'/.exec(all)?.[1] ?? ''
      const excluded = (path: string) => new RegExp(regex).test(path)
      expect(excluded('src-tauri/src/main.rs')).toBe(true)
      expect(excluded('src-tauri/src/foo_test.rs')).toBe(true)
      expect(excluded('src-tauri/tests/real_keyring.rs')).toBe(true)
      for (const covered of ['setup', 'keystore', 'errors', 'dev_seed'])
        expect(excluded(`src-tauri/src/${covered}.rs`)).toBe(false)
      expect(excluded('src-tauri/src/db/key.rs')).toBe(false)
      expect(excluded('src-tauri/src/db/connection.rs')).toBe(false)
      expect(indexOfRun(job, 'bun run build')).toBeLessThan(indexOfRun(job, 'cargo llvm-cov'))
      const install = job.steps.find((s) => s.uses?.startsWith('taiki-e/install-action@'))
      expect(install?.with?.tool).toBe(`cargo-llvm-cov@${llvmCovVersion}`)
    })
  })

  describe('deps job', () => {
    const job = jobOf('deps')
    it('runs on ubuntu for every push and pull request', () => {
      expect(job['runs-on']).toBe('ubuntu-latest')
      expect(job.if).toBeUndefined()
    })
    it('installs a version-pinned cargo-deny with the same action sha as the coverage job', () => {
      const depsInstall = job.steps.find((s) => s.uses?.startsWith(installActionPrefix))
      const coverageInstall = jobOf('core-coverage').steps.find((s) =>
        s.uses?.startsWith(installActionPrefix),
      )
      expect(depsInstall?.with?.tool).toBe(`cargo-deny@${cargoDenyVersion}`)
      expect(depsInstall?.uses).toBe(coverageInstall?.uses)
    })
    it('runs cargo deny locked from src-tauri after installing it', () => {
      const install = stepIndex(job, (s) => s.uses?.startsWith(installActionPrefix) ?? false)
      const deny = indexOfRun(job, 'cargo deny --locked')
      expect(deny).toBeGreaterThan(-1)
      expect(install).toBeLessThan(deny)
      expect(runs(job)[deny]).toMatch(/check\b/)
      expect(runs(job)[deny]).toMatch(/src-tauri|--manifest-path/)
    })
    it('audits javascript dependencies after a frozen install', () => {
      const install = indexOfRun(job, 'bun install --frozen-lockfile')
      const audit = indexOfRun(job, 'bun audit')
      expect(install).toBeGreaterThan(-1)
      expect(audit).toBeGreaterThan(install)
    })
  })

  describe('deny.toml', () => {
    it('does not ignore RUSTSEC-2026-0502', () => {
      expect(denyToml).not.toContain('RUSTSEC-2026-0502')
    })
    it('ignores only the five accepted unmaintained advisories', () => {
      const ids = [...denyToml.matchAll(/id\s*=\s*"(RUSTSEC-[\d-]+)"/g)].map((m) => m[1])
      expect([...ids].sort()).toEqual([
        'RUSTSEC-2024-0370',
        'RUSTSEC-2024-0436',
        'RUSTSEC-2026-0370',
        'RUSTSEC-2026-0371',
        'RUSTSEC-2026-0372',
      ])
    })
    it('gives every ignore a non-trivial reason', () => {
      const entries = denyToml.match(/\{[^{}]*id\s*=\s*"RUSTSEC-[^{}]*\}/g) ?? []
      expect(entries.length).toBe(5)
      for (const e of entries) expect(/reason\s*=\s*"[^"]{20,}"/.test(e)).toBe(true)
    })
    it('allows only crates.io as a source and has no comments', () => {
      expect(denyToml).toMatch(/unknown-registry\s*=\s*"deny"/)
      expect(denyToml).toMatch(/unknown-git\s*=\s*"deny"/)
      expect(denyToml).toMatch(
        /allow-registry\s*=\s*\["https:\/\/github\.com\/rust-lang\/crates\.io-index"\]/,
      )
      expect(denyToml.split('\n').some((l) => l.trimStart().startsWith('#'))).toBe(false)
    })
  })
})
