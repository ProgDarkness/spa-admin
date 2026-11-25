import { invoke } from '@tauri-apps/api/core'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppErrorCode } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { SessionUser } from '@/lib/model'
import { createClientsIpcBackend } from './clients-backend'

const OWNER: SessionUser = { id: 1, username: 'dueña', roleName: 'Propietaria', permissions: ['clients.read', 'clients.write'] }
const SUMMARY_KEYS = ['deletedAt', 'firstName', 'id', 'lastName', 'nationalId', 'phone']
const ERROR_KEYS = ['code', 'entityIds', 'field', 'message']
const BINDINGS_ERROR_CODES: readonly AppErrorCode[] = [
  'invalidCredentials',
  'validation',
  'unauthenticated',
  'forbidden',
  'sessionLocked',
  'notFound',
  'nationalIdTaken',
  'clientDeletedReactivate',
  'internal',
]
const INPUT = { firstName: 'Nueva', lastName: 'Persona', nationalId: 'V-30111222', phone: '0414-5550000' }

let session: SessionUser | null
let invoked: { cmd: string; args: unknown }[]

beforeEach(() => {
  session = OWNER
  invoked = []
  const backend = createClientsIpcBackend(
    (cmd) => {
      throw new Error(`IPC no simulado: ${cmd}`)
    },
    { session: () => session, clients: createSeed('2026-11-12').clients },
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
    await commands.listClients({ query: '', includeDeleted: true })
    await commands.getClient(1)
    await commands.createClient(INPUT)
    await commands.updateClient({ id: 1, ...INPUT, nationalId: 'V-12345678' })
    await commands.setClientDeleted({ id: 1, deleted: true })

    expect(invoked.map((call) => [call.cmd, Object.keys(call.args as object)])).toEqual([
      ['list_clients', ['filter']],
      ['get_client', ['id']],
      ['create_client', ['input']],
      ['update_client', ['update']],
      ['set_client_deleted', ['deletion']],
    ])
  })

  it('todo ClientSummary devuelto tiene exactamente las claves del contrato', async () => {
    const listed = await commands.listClients({ query: '', includeDeleted: true })
    const fetched = await commands.getClient(1)
    const created = await commands.createClient(INPUT)
    const updated = await commands.updateClient({ id: 1, ...INPUT, nationalId: 'V-12345678' })
    const toggled = await commands.setClientDeleted({ id: 2, deleted: true })

    const summaries = [
      ...(listed.status === 'ok' ? listed.data : []),
      ...[fetched, created, updated, toggled].flatMap((outcome) => (outcome.status === 'ok' ? [outcome.data] : [])),
    ]
    expect(summaries.length).toBeGreaterThan(9)
    summaries.forEach((summary) => expect(Object.keys(summary).sort()).toEqual(SUMMARY_KEYS))
  })

  it('los tipos de cada campo del resumen coinciden con el contrato', async () => {
    const created = await commands.createClient(INPUT)
    const deleted = await commands.setClientDeleted({ id: 1, deleted: true })

    expect(created.status === 'ok' && created.data).toMatchObject({
      id: expect.any(Number),
      firstName: expect.any(String),
      lastName: expect.any(String),
      nationalId: expect.any(String),
      phone: expect.any(String),
      deletedAt: null,
    })
    expect(deleted.status === 'ok' && deleted.data.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('los errores llevan las cuatro claves de AppError y un código existente en bindings', async () => {
    const validation = await errorOf(() => commands.createClient({ ...INPUT, firstName: '' }))
    const taken = await errorOf(() => commands.createClient({ ...INPUT, nationalId: 'V-12345678' }))
    await commands.setClientDeleted({ id: 1, deleted: true })
    const reactivate = await errorOf(() => commands.createClient({ ...INPUT, nationalId: 'V-12345678' }))
    const missing = await errorOf(() => commands.getClient(999))
    session = null
    const unauthenticated = await errorOf(() => commands.listClients({ query: '', includeDeleted: true }))
    session = { ...OWNER, permissions: [] }
    const forbidden = await errorOf(() => commands.listClients({ query: '', includeDeleted: true }))

    ;[validation, taken, reactivate, missing, unauthenticated, forbidden].forEach((error) => {
      expect(Object.keys(error).sort()).toEqual(ERROR_KEYS)
      expect(BINDINGS_ERROR_CODES).toContain(error.code)
      expect(typeof error.message).toBe('string')
    })
    expect(validation).toMatchObject({ code: 'validation', field: 'firstName', entityIds: null })
    expect(taken).toMatchObject({ code: 'nationalIdTaken', field: 'nationalId', entityIds: null })
    expect(reactivate).toMatchObject({ code: 'clientDeletedReactivate', field: 'nationalId', entityIds: [1] })
    expect(missing).toMatchObject({ code: 'notFound', field: null, entityIds: null })
    expect(unauthenticated).toMatchObject({ code: 'unauthenticated', field: null, entityIds: null })
    expect(forbidden).toMatchObject({ code: 'forbidden', field: null, entityIds: null })
  })

  it('un id inexistente es notFound y no validation, como en Rust', async () => {
    const missing = await errorOf(() => commands.setClientDeleted({ id: 999, deleted: true }))

    expect(missing.code).toBe('notFound')
  })

  it('el rechazo del IPC crudo es el AppError y no un Error de JavaScript', async () => {
    session = null

    const rejection = await invoke('list_clients', { filter: { query: '', includeDeleted: true } }).catch(
      (caught: unknown) => caught,
    )

    expect(rejection).not.toBeInstanceOf(Error)
    expect(rejection).toMatchObject({ code: 'unauthenticated' })
  })
})
