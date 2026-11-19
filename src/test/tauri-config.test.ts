import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface TauriConfig {
  identifier: string
  build: { frontendDist: string; beforeBuildCommand: string; beforeDevCommand: string; devUrl: string }
  app: { windows: { label: string }[]; security: { csp: string; devCsp: string } }
}

interface Capability {
  identifier: string
  windows: string[]
}

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as T

const tauriConfig = () => readJson<TauriConfig>('src-tauri/tauri.conf.json')

const parseCsp = (csp: string): Map<string, string[]> =>
  new Map(
    csp
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter((tokens) => tokens[0])
      .map(([name, ...sources]): [string, string[]] => [name as string, sources]),
  )

const cspDirectives = (): Map<string, string[]> => parseCsp(tauriConfig().app.security.csp)

const devCspDirectives = (): Map<string, string[]> => parseCsp(tauriConfig().app.security.devCsp)

describe('tauri.conf.json', () => {
  it('declara el identificador de la aplicación', () => {
    expect(tauriConfig().identifier).toBe('com.progdarkness.spa')
  })

  it('enlaza el build con el export estático de Next', () => {
    const { build } = tauriConfig()
    expect(build.frontendDist).toBe('../out')
    expect(build.beforeBuildCommand).toBe('bun run build')
    expect(build.beforeDevCommand).toBe('bun run dev')
    expect(build.devUrl).toBe('http://localhost:3000')
  })

  it('define una CSP estricta', () => {
    const directives = cspDirectives()
    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
  })

  it('no permite scripts inline en script-src', () => {
    expect(cspDirectives().get('script-src')).toEqual(["'self'"])
  })

  it('no permite conexiones http ni https salvo el canal IPC', () => {
    const connectSources = cspDirectives().get('connect-src') ?? []
    expect(connectSources).toContain('ipc:')
    expect(connectSources.filter((source) => /^https?:\/\/(?!ipc\.localhost)/.test(source))).toEqual([])
    expect(connectSources).not.toContain('*')
  })

  it('permite el canal websocket y http del servidor de desarrollo solo en devCsp', () => {
    const devConnect = devCspDirectives().get('connect-src') ?? []
    expect(devConnect).toEqual(
      expect.arrayContaining(['ipc:', 'http://ipc.localhost', 'ws://localhost:3000', 'http://localhost:3000']),
    )
    const prodConnect = cspDirectives().get('connect-src') ?? []
    expect(prodConnect).not.toContain('ws://localhost:3000')
    expect(prodConnect).not.toContain('http://localhost:3000')
    expect(tauriConfig().app.security.csp).not.toContain('localhost:3000')
  })

  it('mantiene en devCsp las restricciones base de la CSP de producción', () => {
    const devDirectives = devCspDirectives()
    expect(devDirectives.get('default-src')).toEqual(["'self'"])
    expect(devDirectives.get('object-src')).toEqual(["'none'"])
    expect(devDirectives.get('frame-ancestors')).toEqual(["'none'"])
    expect(devDirectives.get('script-src')).toContain("'self'")
  })

  it('declara la ventana principal', () => {
    expect(tauriConfig().app.windows[0]?.label).toBe('main')
  })
})

describe('capabilities/default.json', () => {
  it('limita la capability por defecto a la ventana main', () => {
    const capability = readJson<Capability>('src-tauri/capabilities/default.json')
    expect(capability.identifier).toBe('default')
    expect(capability.windows).toEqual(['main'])
  })
})
