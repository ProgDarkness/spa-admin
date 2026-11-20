import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface AuditWaiver {
  id: string
  package: string
  vulnerableUpTo: string
  reason: string
  removeWhen: string
}

const readRepoFile = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

const waivers: AuditWaiver[] = JSON.parse(readRepoFile('.github/audit-waivers.json'))

const splitVersion = (version: string) => {
  const [core = '', prerelease] = version.split(/-(.*)/s)
  return { numbers: core.split('.').map(Number), isPrerelease: prerelease !== undefined }
}

const compareVersions = (left: string, right: string) => {
  const leftVersion = splitVersion(left)
  const rightVersion = splitVersion(right)
  const difference = leftVersion.numbers
    .map((part, index) => part - (rightVersion.numbers[index] ?? 0))
    .find((delta) => delta !== 0)
  if (difference !== undefined) return difference
  return Number(rightVersion.isPrerelease) - Number(leftVersion.isPrerelease)
}

interface DepsWorkflow {
  jobs: { deps: { steps: { run?: string }[] } }
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const resolvedVersions = (lockText: string, packageName: string) =>
  [
    ...lockText.matchAll(
      new RegExp(`"${escapeRegex(packageName)}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)"`, 'g'),
    ),
  ].map((match) => match[1] ?? '')

const ignoredIdsFromWorkflow = (text: string): string[] =>
  (parse(text) as DepsWorkflow).jobs.deps.steps
    .map((step) => step.run ?? '')
    .filter((command) => /\bbun audit\b/.test(command))
    .flatMap((command) => [...command.matchAll(/--ignore(?:=|\s+)["']?([A-Za-z0-9-]+)/g)].map((match) => match[1] ?? ''))

const staleWaivers = (candidates: AuditWaiver[], lockText: string): AuditWaiver[] =>
  candidates.filter(
    (waiver) =>
      !resolvedVersions(lockText, waiver.package).some(
        (version) => compareVersions(version, waiver.vulnerableUpTo) <= 0,
      ),
  )

interface RegistryMismatch {
  unregistered: string[]
  unused: string[]
}

const registryMismatch = (ciText: string, registered: AuditWaiver[]): RegistryMismatch => {
  const ignored = ignoredIdsFromWorkflow(ciText)
  const registeredIds = registered.map((waiver) => waiver.id)
  return {
    unregistered: ignored.filter((id) => !registeredIds.includes(id)),
    unused: registeredIds.filter((id) => !ignored.includes(id)),
  }
}

const lockfileResolving = (packageName: string, versions: string[]) =>
  versions.map((version) => `    "${packageName}": ["${packageName}@${version}", "", {}],`).join('\n')

const sampleWaiver = (overrides: Partial<AuditWaiver> = {}): AuditWaiver => ({
  id: 'GHSA-aaaa-bbbb-cccc',
  package: 'picomatch',
  vulnerableUpTo: '4.0.7',
  reason: 'motivo',
  removeWhen: 'condicion',
  ...overrides,
})

const workflowWithDepsSteps = (runs: string[]) =>
  `jobs:\n  deps:\n    steps:\n${runs.map((run) => `      - run: ${run}`).join('\n')}\n`

describe('ignoredIdsFromWorkflow', () => {
  it('devuelve lista vacia cuando bun audit no ignora ningun id', () => {
    expect(ignoredIdsFromWorkflow(workflowWithDepsSteps(['bun audit']))).toEqual([])
  })

  it('devuelve el id ignorado por bun audit', () => {
    expect(ignoredIdsFromWorkflow(workflowWithDepsSteps(['bun audit --ignore=GHSA-aaaa-bbbb-cccc']))).toEqual([
      'GHSA-aaaa-bbbb-cccc',
    ])
  })

  it('devuelve todos los ids ignorados en el mismo comando', () => {
    expect(
      ignoredIdsFromWorkflow(
        workflowWithDepsSteps(['bun audit --ignore=GHSA-aaaa-bbbb-cccc --ignore=GHSA-dddd-eeee-ffff']),
      ),
    ).toEqual(['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff'])
  })

  it('devuelve el id cuando el flag usa un espacio en lugar de =', () => {
    expect(ignoredIdsFromWorkflow(workflowWithDepsSteps(['bun audit --ignore GHSA-aaaa-bbbb-cccc']))).toEqual([
      'GHSA-aaaa-bbbb-cccc',
    ])
  })

  it('devuelve los ids cuando se mezclan las formas con = y con espacio y otros flags', () => {
    expect(
      ignoredIdsFromWorkflow(
        workflowWithDepsSteps(['bun audit --audit-level high --ignore GHSA-aaaa-bbbb-cccc --ignore=GHSA-dddd-eeee-ffff']),
      ),
    ).toEqual(['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff'])
  })

  it('devuelve el id cuando va entre comillas', () => {
    expect(
      ignoredIdsFromWorkflow(workflowWithDepsSteps([`bun audit --ignore "GHSA-aaaa-bbbb-cccc" --ignore='GHSA-dddd-eeee-ffff'`])),
    ).toEqual(['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff'])
  })

  it('ignora flags --ignore= de pasos que no son bun audit', () => {
    expect(ignoredIdsFromWorkflow(workflowWithDepsSteps(['cargo llvm-cov --ignore=GHSA-aaaa-bbbb-cccc']))).toEqual([])
  })
})

describe('resolvedVersions', () => {
  it('no confunde un nombre con metacaracteres de regex con otro paquete', () => {
    const lockText = lockfileResolving('axb', ['1.0.0'])

    expect(resolvedVersions(lockText, 'a.b')).toEqual([])
  })

  it('encuentra paquetes cuyo nombre contiene metacaracteres de regex', () => {
    const lockText = lockfileResolving('a.b', ['1.0.0'])

    expect(resolvedVersions(lockText, 'a.b')).toEqual(['1.0.0'])
  })

  it('reconoce versiones prerelease completas', () => {
    const lockText = lockfileResolving('picomatch', ['4.0.7-beta', '4.0.8-rc.1'])

    expect(resolvedVersions(lockText, 'picomatch')).toEqual(['4.0.7-beta', '4.0.8-rc.1'])
  })

  it('no mezcla un paquete con scope con su homonimo sin scope', () => {
    const lockText = lockfileResolving('@scope/pkg', ['2.0.0'])

    expect(resolvedVersions(lockText, 'pkg')).toEqual([])
  })
})

describe('compareVersions', () => {
  it('ordena una prerelease antes de su version estable', () => {
    expect(compareVersions('4.0.7-beta', '4.0.7')).toBeLessThan(0)
    expect(compareVersions('4.0.7', '4.0.7-beta')).toBeGreaterThan(0)
  })

  it('ordena una prerelease de una version mayor despues de la estable menor', () => {
    expect(compareVersions('4.0.8-beta', '4.0.7')).toBeGreaterThan(0)
  })
})

describe('staleWaivers', () => {
  it('no marca como obsoleto un waiver cuando el lock resuelve una prerelease de la version vulnerable', () => {
    expect(staleWaivers([sampleWaiver()], lockfileResolving('picomatch', ['4.0.7-beta']))).toEqual([])
  })

  it('marca como obsoleto un waiver cuando el lock solo resuelve una prerelease posterior al limite', () => {
    const waiver = sampleWaiver()

    expect(staleWaivers([waiver], lockfileResolving('picomatch', ['4.0.8-beta']))).toEqual([waiver])
  })

  it('devuelve lista vacia sin waivers', () => {
    expect(staleWaivers([], lockfileResolving('picomatch', ['4.0.7']))).toEqual([])
  })

  it('no marca como obsoleto un waiver cuando el lock resuelve una version vulnerable', () => {
    expect(staleWaivers([sampleWaiver()], lockfileResolving('picomatch', ['4.0.7']))).toEqual([])
  })

  it('marca como obsoleto un waiver cuando el lock solo resuelve versiones mayores', () => {
    const waiver = sampleWaiver()

    expect(staleWaivers([waiver], lockfileResolving('picomatch', ['4.0.8']))).toEqual([waiver])
  })

  it('marca como obsoleto un waiver cuando el lock no resuelve el paquete', () => {
    const waiver = sampleWaiver()

    expect(staleWaivers([waiver], lockfileResolving('otro', ['1.0.0']))).toEqual([waiver])
  })

  it('compara versiones numericamente', () => {
    const waiver = sampleWaiver({ vulnerableUpTo: '4.0.9' })

    expect(staleWaivers([waiver], lockfileResolving('picomatch', ['4.0.10']))).toEqual([waiver])
  })
})

describe('audit waivers del repositorio', () => {
  const ciText = readRepoFile('.github/workflows/ci.yml')
  const lockText = readRepoFile('bun.lock')

  it('el bun.lock real resuelve las versiones de picomatch que el chequeo de obsolescencia necesita ver', () => {
    expect(resolvedVersions(lockText, 'picomatch')).toEqual(expect.arrayContaining(['4.0.7', '2.3.2']))
  })

  it('el chequeo de obsolescencia marca un waiver por debajo de lo que resuelve el bun.lock real y respeta uno vigente', () => {
    const outdated = sampleWaiver({ package: 'typescript', vulnerableUpTo: '1.0.0' })
    const current = sampleWaiver({ id: 'GHSA-dddd-eeee-ffff', package: 'picomatch', vulnerableUpTo: '4.0.7' })

    expect(staleWaivers([outdated, current], lockText)).toEqual([outdated])
  })

  it('la correspondencia 1:1 detecta un id ignorado en el workflow sin waiver y un waiver sin id ignorado', () => {
    const orphanedIgnore = workflowWithDepsSteps(['bun audit --ignore GHSA-aaaa-bbbb-cccc'])
    const unusedWaiver = workflowWithDepsSteps(['bun audit'])

    expect(registryMismatch(orphanedIgnore, [])).toEqual({ unregistered: ['GHSA-aaaa-bbbb-cccc'], unused: [] })
    expect(registryMismatch(unusedWaiver, [sampleWaiver()])).toEqual({ unregistered: [], unused: ['GHSA-aaaa-bbbb-cccc'] })
    expect(registryMismatch(orphanedIgnore, [sampleWaiver()])).toEqual({ unregistered: [], unused: [] })
  })

  it('registra cada id ignorado en ci.yml con motivo y condición de retiro', () => {
    for (const id of ignoredIdsFromWorkflow(ciText)) {
      const waiver = waivers.find((entry) => entry.id === id)
      expect(waiver, `waiver ${id} sin registro`).toBeDefined()
      expect(waiver?.reason.trim().length).toBeGreaterThan(0)
      expect(waiver?.removeWhen.trim().length).toBeGreaterThan(0)
    }
  })

  it('mantiene correspondencia 1:1 entre waivers registrados e ids ignorados en ci.yml', () => {
    expect(registryMismatch(ciText, waivers)).toEqual({ unregistered: [], unused: [] })
  })

  it('no conserva waivers cuyo bun.lock ya no resuelve una versión vulnerable', () => {
    const stale = staleWaivers(waivers, lockText)

    expect(stale.map((waiver) => `retirar waiver ${waiver.id}: ${waiver.removeWhen}`)).toEqual([])
  })
})

interface GuardResult {
  status: number | null
  output: string
}

const guardStepScript = () => {
  const workflow = parse(readRepoFile('.github/workflows/ci.yml')) as DepsWorkflow
  const script = workflow.jobs.deps.steps
    .map((step) => step.run ?? '')
    .find((command) => command.includes('bun pm view'))
  expect(script, 'paso guard con bun pm view no encontrado en el job deps').toBeDefined()
  return script ?? ''
}

const sandboxes: string[] = []

const bunStubScript = (latestByPackage: Record<string, string>) => {
  const cases = Object.entries(latestByPackage)
    .map(([packageName, version]) => `  "pm view ${packageName} version") printf '%s\\n' '${version}' ;;`)
    .join('\n')
  return `#!/bin/sh\ncat >/dev/null\ncase "$*" in\n${cases}\n  *) echo "stub bun: argumentos inesperados: $*" >&2; exit 2 ;;\nesac\n`
}

const runGuard = (waiversJson: string, latest: string | Record<string, string>): GuardResult => {
  const latestByPackage = typeof latest === 'string' ? { picomatch: latest } : latest
  const sandbox = mkdtempSync(join(tmpdir(), 'audit-guard-'))
  sandboxes.push(sandbox)
  mkdirSync(join(sandbox, '.github'))
  mkdirSync(join(sandbox, 'bin'))
  writeFileSync(join(sandbox, '.github', 'audit-waivers.json'), waiversJson)
  const stub = join(sandbox, 'bin', 'bun')
  writeFileSync(stub, bunStubScript(latestByPackage))
  chmodSync(stub, 0o755)
  const result = spawnSync('bash', ['-e', '-c', guardStepScript()], {
    cwd: sandbox,
    env: { ...process.env, PATH: [join(sandbox, 'bin'), process.env.PATH ?? ''].join(delimiter) },
    encoding: 'utf8',
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const guardWaiver = (overrides: Record<string, unknown> = {}) => ({
  id: 'GHSA-aaaa-bbbb-cccc',
  package: 'picomatch',
  vulnerableUpTo: '4.0.7',
  reason: 'motivo',
  removeWhen: 'condicion',
  ...overrides,
})

const guardJson = (...entries: Record<string, unknown>[]) => JSON.stringify(entries)

const waiverJson = (id: string, limit: string) => guardJson(guardWaiver({ id, vulnerableUpTo: limit }))

const workflowCommandLines = (output: string) => output.split('\n').filter((line) => line.startsWith('::'))

describe('guard de waivers en ci.yml', () => {
  afterEach(() => {
    for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true })
  })

  it('requiere bash y jq: usa pipefail y here-strings de bash y lee el JSON con jq, por lo que ambos binarios deben existir', () => {
    const script = guardStepScript()
    const bash = spawnSync('bash', ['--version'])
    const jq = spawnSync('jq', ['--version'])

    expect(script).toContain('pipefail')
    expect(script).toContain('<<<')
    expect(script).toMatch(/\bjq\b/)
    expect(bash.status, 'bash no esta disponible: el guard usa pipefail y here-strings, exclusivos de bash').toBe(0)
    expect(jq.status, 'jq no esta disponible: el guard lee audit-waivers.json con jq').toBe(0)
  })

  it('sale 0 sin waivers registrados', () => {
    const result = runGuard('[]', '4.0.7')

    expect(result.status, result.output).toBe(0)
  })

  it('sale 0 cuando la ultima version coincide con el limite del waiver', () => {
    const result = runGuard(waiverJson('GHSA-aaaa-bbbb-cccc', '4.0.7'), '4.0.7')

    expect(result.status, result.output).toBe(0)
  })

  it('sale 1 y nombra el id cuando la ultima version supera el limite', () => {
    const result = runGuard(waiverJson('GHSA-aaaa-bbbb-cccc', '4.0.7'), '4.0.8')

    expect(result.status).toBe(1)
    expect(result.output).toContain('GHSA-aaaa-bbbb-cccc')
  })

  it('compara versiones numericamente y no lexicograficamente', () => {
    const result = runGuard(waiverJson('GHSA-aaaa-bbbb-cccc', '4.0.9'), '4.0.10')

    expect(result.status).toBe(1)
    expect(result.output).toContain('GHSA-aaaa-bbbb-cccc')
  })

  it('sale 1 y nombra el id cuando vulnerableUpTo esta vacio', () => {
    const result = runGuard(waiverJson('GHSA-aaaa-bbbb-cccc', ''), '4.0.7')

    expect(result.status).toBe(1)
    expect(result.output).toContain('GHSA-aaaa-bbbb-cccc')
  })

  it('sale 1 y nombra el id cuando la clave vulnerableUpTo esta omitida', () => {
    const waiversJson = JSON.stringify([
      { id: 'GHSA-aaaa-bbbb-cccc', package: 'picomatch', reason: 'motivo', removeWhen: 'condicion' },
    ])

    const result = runGuard(waiversJson, '4.0.7')

    expect(result.status).toBe(1)
    expect(result.output).toContain('GHSA-aaaa-bbbb-cccc')
    expect(result.output).toContain('campo vulnerableUpTo')
  })

  it('sale 1 nombrando el campo package cuando parece una opcion de linea de comandos', () => {
    const result = runGuard(guardJson(guardWaiver({ package: '--registry=x' })), '4.0.7')

    expect(result.status).toBe(1)
    expect(result.output).toContain('campo package')
    expect(result.output).toContain('GHSA-aaaa-bbbb-cccc')
  })

  it('sale 1 nombrando el campo package cuando empieza con guion', () => {
    const result = runGuard(guardJson(guardWaiver({ package: '--help' })), '4.0.7')

    expect(result.status).toBe(1)
    expect(result.output).toContain('campo package')
  })

  it('sale 1 sin emitir workflow commands cuando package contiene ::', () => {
    const result = runGuard(guardJson(guardWaiver({ package: '::warning::x' })), '4.0.7')

    expect(result.status).toBe(1)
    expect(result.output).toContain('campo package')
    expect(workflowCommandLines(result.output)).toEqual([])
  })

  it('sale 1 nombrando el campo package cuando esta vacio', () => {
    const result = runGuard(guardJson(guardWaiver({ package: '' })), '4.0.7')

    expect(result.status).toBe(1)
    expect(result.output).toContain('campo package')
  })

  it('acepta paquetes con scope', () => {
    const result = runGuard(guardJson(guardWaiver({ package: '@scope/pkg' })), { '@scope/pkg': '4.0.7' })

    expect(result.status, result.output).toBe(0)
  })

  it('sale 1 sin emitir workflow commands cuando el id es invalido', () => {
    const result = runGuard(guardJson(guardWaiver({ id: '::warning::x' })), '4.0.7')

    expect(result.status).toBe(1)
    expect(result.output).toContain('campo id')
    expect(workflowCommandLines(result.output)).toEqual([])
  })

  it('sale 1 nombrando el campo id cuando esta vacio o con mayusculas', () => {
    const empty = runGuard(guardJson(guardWaiver({ id: '' })), '4.0.7')
    const upper = runGuard(guardJson(guardWaiver({ id: 'GHSA-AAAA-bbbb-cccc' })), '4.0.7')

    expect(empty.status).toBe(1)
    expect(empty.output).toContain('campo id')
    expect(upper.status).toBe(1)
    expect(upper.output).toContain('campo id')
  })

  it('sale 1 nombrando el campo vulnerableUpTo cuando no es X.Y.Z', () => {
    const short = runGuard(waiverJson('GHSA-aaaa-bbbb-cccc', '4.0'), '4.0.7')
    const prerelease = runGuard(waiverJson('GHSA-aaaa-bbbb-cccc', '4.0.7-beta.1'), '4.0.7')

    expect(short.status).toBe(1)
    expect(short.output).toContain('campo vulnerableUpTo')
    expect(prerelease.status).toBe(1)
    expect(prerelease.output).toContain('campo vulnerableUpTo')
  })

  it('sale 1 nombrando el id cuando la ultima version consultada esta vacia', () => {
    const result = runGuard(waiverJson('GHSA-aaaa-bbbb-cccc', '4.0.7'), '')

    expect(result.status).toBe(1)
    expect(result.output).toContain('GHSA-aaaa-bbbb-cccc')
    expect(result.output).toContain('ultima version')
  })

  it('rechaza una ultima version prerelease por no cumplir X.Y.Z', () => {
    const result = runGuard(waiverJson('GHSA-aaaa-bbbb-cccc', '4.0.7'), '4.0.8-beta.1')

    expect(result.status).toBe(1)
    expect(result.output).toContain('GHSA-aaaa-bbbb-cccc')
    expect(result.output).toContain('X.Y.Z')
  })

  it('propaga el exit 2 del stub de bun y nombra el comando cuando el guard consulta un paquete que el stub no conoce', () => {
    const result = runGuard(guardJson(guardWaiver({ package: 'otro' })), { picomatch: '4.0.7' })

    expect(result.status).toBe(2)
    expect(result.output).toContain('argumentos inesperados: pm view otro version')
  })

  it('sale distinto de 0 con JSON malformado', () => {
    const result = runGuard('{no es json', '4.0.7')

    expect(result.status).not.toBe(0)
    expect(result.status).not.toBeNull()
  })

  it('sale 1 nombrando el segundo waiver cuando solo el segundo supera el limite', () => {
    const waiversJson = guardJson(
      guardWaiver({ id: 'GHSA-aaaa-bbbb-cccc', package: 'picomatch', vulnerableUpTo: '4.0.7' }),
      guardWaiver({ id: 'GHSA-dddd-eeee-ffff', package: 'otro', vulnerableUpTo: '1.0.0' }),
    )

    const result = runGuard(waiversJson, { picomatch: '4.0.7', otro: '1.0.1' })

    expect(result.status).toBe(1)
    expect(result.output).toContain('GHSA-dddd-eeee-ffff')
    expect(result.output).not.toContain('GHSA-aaaa-bbbb-cccc')
  })

  it('sale 0 con dos waivers validos', () => {
    const waiversJson = guardJson(
      guardWaiver({ id: 'GHSA-aaaa-bbbb-cccc', package: 'picomatch', vulnerableUpTo: '4.0.7' }),
      guardWaiver({ id: 'GHSA-dddd-eeee-ffff', package: 'otro', vulnerableUpTo: '1.0.0' }),
    )

    const result = runGuard(waiversJson, { picomatch: '4.0.7', otro: '1.0.0' })

    expect(result.status, result.output).toBe(0)
  })
})
