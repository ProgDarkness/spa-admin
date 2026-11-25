import { invoke } from '@tauri-apps/api/core'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppErrorCode } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { SessionUser } from '@/lib/model'
import { createResourcesIpcBackend } from './resources-backend'

const OWNER: SessionUser = { id: 1, username: 'dueña', roleName: 'Propietaria', permissions: ['appointments.read', 'resources.manage'] }
const SUMMARY_KEYS = ['active', 'createdAt', 'id', 'kind', 'name', 'updatedAt']
const ERROR_KEYS = ['code', 'entityIds', 'field', 'message']
const BINDINGS_ERROR_CODES: readonly AppErrorCode[] = [
  'invalidCredentials',
  'validation',
  'unauthenticated',
  'forbidden',
  'sessionLocked',
  'internal',
]

let session: SessionUser | null
let invoked: { cmd: string; args: unknown }[]

beforeEach(() => {
  session = OWNER
  invoked = []
  const backend = createResourcesIpcBackend(
    (cmd) => {
      throw new Error(`IPC no simulado: ${cmd}`)
    },
    { session: () => session, resources: createSeed('2026-11-12').resources },
  )
  mockIPC((cmd, args) => {
    invoked.push({ cmd, args })
    return backend(cmd, args)
  })
})

afterEach(() => clearMocks())

async function errorOf(operation: () => Promise<{ status: string; error?: unknown }>): Promise<Record<string, unknown>> {
  const outcome = await operation()
  if (outcome.status !== 'error' || typeof outcome.error !== 'object' || outcome.error === null) {
    throw new Error('se esperaba un error')
  }
  return outcome.error as Record<string, unknown>
}

describe('paridad de forma con los bindings generados', () => {
  it('cada comando viaja con el nombre y la clave de argumento del contrato', async () => {
    await commands.listResources({ includeInactive: true })
    await commands.createResource({ name: 'Nuevo', kind: 'cabin' })
    await commands.updateResource({ id: 1, name: 'Otro', kind: 'manicure' })
    await commands.setResourceActive({ id: 1, active: false })

    expect(invoked.map((call) => [call.cmd, Object.keys(call.args as object)])).toEqual([
      ['list_resources', ['filter']],
      ['create_resource', ['input']],
      ['update_resource', ['update']],
      ['set_resource_active', ['activation']],
    ])
  })

  it('todo ResourceSummary devuelto tiene exactamente las claves del contrato', async () => {
    const listed = await commands.listResources({ includeInactive: true })
    const created = await commands.createResource({ name: 'Nuevo', kind: 'cabin' })
    const updated = await commands.updateResource({ id: 1, name: 'Otro', kind: 'manicure' })
    const toggled = await commands.setResourceActive({ id: 1, active: false })

    const summaries = [
      ...(listed.status === 'ok' ? listed.data : []),
      ...[created, updated, toggled].flatMap((outcome) => (outcome.status === 'ok' ? [outcome.data] : [])),
    ]
    expect(summaries.length).toBeGreaterThan(4)
    summaries.forEach((summary) => expect(Object.keys(summary).sort()).toEqual(SUMMARY_KEYS))
  })

  it('los tipos de cada campo del resumen coinciden con el contrato', async () => {
    const created = await commands.createResource({ name: 'Nuevo', kind: 'manicure' })

    expect(created.status === 'ok' && created.data).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      kind: 'manicure',
      active: expect.any(Boolean),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })

  it('los errores llevan las cuatro claves de AppError y un código existente en bindings', async () => {
    const validation = await errorOf(() => commands.createResource({ name: '', kind: 'cabin' }))
    session = null
    const unauthenticated = await errorOf(() => commands.listResources({ includeInactive: true }))
    session = { ...OWNER, permissions: [] }
    const forbidden = await errorOf(() => commands.listResources({ includeInactive: true }))

    ;[validation, unauthenticated, forbidden].forEach((error) => {
      expect(Object.keys(error).sort()).toEqual(ERROR_KEYS)
      expect(BINDINGS_ERROR_CODES).toContain(error.code)
      expect(typeof error.message).toBe('string')
    })
    expect(validation).toMatchObject({ code: 'validation', field: 'name', entityIds: null })
    expect(unauthenticated).toMatchObject({ code: 'unauthenticated', field: null, entityIds: null })
    expect(forbidden).toMatchObject({ code: 'forbidden', field: null, entityIds: null })
  })

  it('nunca emite notFound: un id inexistente es validation con field id', async () => {
    const missing = await errorOf(() => commands.setResourceActive({ id: 999, active: true }))

    expect(missing).toMatchObject({ code: 'validation', field: 'id' })
    expect(missing.code).not.toBe('notFound')
  })

  it('el rechazo del IPC crudo es el AppError y no un Error de JavaScript', async () => {
    session = null

    const rejection = await invoke('list_resources', { filter: { includeInactive: true } }).catch((caught: unknown) => caught)

    expect(rejection).not.toBeInstanceOf(Error)
    expect(rejection).toMatchObject({ code: 'unauthenticated' })
  })
})
