import { invoke } from '@tauri-apps/api/core'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppErrorCode } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { SessionUser } from '@/lib/model'
import { createDevBackends } from './dev-backends'

const OWNER: SessionUser = {
  id: 1,
  username: 'dueña',
  roleName: 'Propietaria',
  permissions: ['appointments.read', 'appointments.write', 'appointments.reopen', 'resources.manage'],
}
const SUMMARY_KEYS = [
  'clientId',
  'durationMinSnapshot',
  'endsAt',
  'id',
  'notes',
  'priceCentsSnapshot',
  'resourceId',
  'serviceId',
  'startsAt',
  'status',
]
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
  'overlap',
  'crossesMidnight',
  'invalidTransition',
  'resourceInactive',
  'resourceHasFutureAppointments',
  'internal',
]
const SEED = createSeed('2026-11-12')
const DAY = '2030-01-10'
const INPUT = { clientId: 1, serviceId: 1, resourceId: 1, startsAt: `${DAY}T10:00`, notes: null }

let session: SessionUser | null
let invoked: { cmd: string; args: unknown }[]

beforeEach(() => {
  session = OWNER
  invoked = []
  const backend = createDevBackends({
    auth: () => {
      throw new Error('IPC no simulado')
    },
    session: () => session,
    seed: { ...SEED, appointments: [] },
  })
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
    await commands.listAppointments({ from: DAY, to: DAY, resourceId: null })
    await commands.createAppointment(INPUT)
    await commands.moveAppointment({ id: 1, startsAt: `${DAY}T12:00`, resourceId: 1 })
    await commands.transitionAppointment({ id: 1, transition: 'start' })
    await commands.listFutureAppointmentsOfResource(1)

    expect(invoked.map((call) => [call.cmd, Object.keys(call.args as object)])).toEqual([
      ['list_appointments', ['range']],
      ['create_appointment', ['input']],
      ['move_appointment', ['movement']],
      ['transition_appointment', ['request']],
      ['list_future_appointments_of_resource', ['id']],
    ])
  })

  it('todo AppointmentSummary devuelto tiene exactamente las claves del contrato y los tipos esperados', async () => {
    const created = await commands.createAppointment({ ...INPUT, notes: 'nota' })
    const moved = await commands.moveAppointment({ id: 1, startsAt: `${DAY}T12:00`, resourceId: 2 })
    const started = await commands.transitionAppointment({ id: 1, transition: 'start' })
    const listed = await commands.listAppointments({ from: DAY, to: DAY, resourceId: null })

    const summaries = [
      ...[created, moved, started].flatMap((outcome) => (outcome.status === 'ok' ? [outcome.data] : [])),
      ...(listed.status === 'ok' ? listed.data : []),
    ]
    expect(summaries).toHaveLength(4)
    summaries.forEach((summary) => expect(Object.keys(summary).sort()).toEqual(SUMMARY_KEYS))
    expect(created.status === 'ok' && created.data).toMatchObject({
      id: expect.any(Number),
      startsAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      endsAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      status: 'scheduled',
      priceCentsSnapshot: expect.any(Number),
      durationMinSnapshot: expect.any(Number),
      notes: 'nota',
    })
    expect(started.status === 'ok' && started.data.status).toBe('inProgress')
  })

  it('los errores llevan las cuatro claves de AppError y un código existente en bindings', async () => {
    await commands.createAppointment(INPUT)
    const overlap = await errorOf(() => commands.createAppointment(INPUT))
    const midnight = await errorOf(() => commands.createAppointment({ ...INPUT, resourceId: 2, startsAt: `${DAY}T23:30` }))
    const transition = await errorOf(() => commands.transitionAppointment({ id: 1, transition: 'reopen' }))
    const inactive = await errorOf(() => commands.createAppointment({ ...INPUT, resourceId: 3 }))
    const missing = await errorOf(() => commands.createAppointment({ ...INPUT, clientId: 999 }))
    const validation = await errorOf(() => commands.createAppointment({ ...INPUT, startsAt: `${DAY}T10:01` }))
    const future = await errorOf(() => commands.setResourceActive({ id: 1, active: false }))
    session = null
    const unauthenticated = await errorOf(() => commands.listAppointments({ from: DAY, to: DAY, resourceId: null }))

    const errors = [overlap, midnight, transition, inactive, missing, validation, future, unauthenticated]
    errors.forEach((error) => {
      expect(Object.keys(error).sort()).toEqual(ERROR_KEYS)
      expect(BINDINGS_ERROR_CODES).toContain(error.code)
      expect(typeof error.message).toBe('string')
    })
    expect(overlap).toMatchObject({ code: 'overlap', field: 'startsAt', entityIds: [1] })
    expect(midnight).toMatchObject({ code: 'crossesMidnight', field: 'startsAt', entityIds: null })
    expect(transition).toMatchObject({ code: 'invalidTransition', field: null, entityIds: null })
    expect(inactive).toMatchObject({ code: 'resourceInactive', field: 'resourceId', entityIds: null })
    expect(missing).toMatchObject({ code: 'notFound', field: 'clientId', entityIds: null })
    expect(validation).toMatchObject({ code: 'validation', field: 'startsAt', entityIds: null })
    expect(future).toMatchObject({ code: 'resourceHasFutureAppointments', field: null, entityIds: [1] })
  })

  it('list_all_appointments viaja sin argumentos y devuelve resúmenes con las claves del contrato', async () => {
    await commands.createAppointment(INPUT)

    const listed = await commands.listAllAppointments()

    expect(invoked.at(-1)?.cmd).toBe('list_all_appointments')
    expect(listed.status === 'ok' && listed.data.map((summary) => Object.keys(summary).sort())).toEqual([SUMMARY_KEYS])
  })

  it('sin sesión, un transition con argumentos malformados es unauthenticated y no un fallo de canal', async () => {
    session = null

    const outcome = await commands.transitionAppointment({ id: 'x', transition: 'explode' } as never)

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('mover una cita a su propio hueco en un recurso inactivo es un no-op', async () => {
    const backend = createDevBackends({
      auth: () => null,
      session: () => session,
      seed: { ...SEED, appointments: [{ ...SEED.appointments[0]!, id: 1, resourceId: 3, status: 'scheduled' }] },
    })
    const row = SEED.appointments[0]!
    clearMocks()
    mockIPC((cmd, args) => backend(cmd, args))

    const outcome = await commands.moveAppointment({ id: 1, startsAt: row.startsAt, resourceId: 3 })

    expect(outcome).toMatchObject({ status: 'ok', data: { id: 1, resourceId: 3, startsAt: row.startsAt } })
  })

  it('una cita creada en el IPC bloquea la desactivación del recurso desde el backend compuesto', async () => {
    await commands.createAppointment(INPUT)

    const future = await commands.listFutureAppointmentsOfResource(1)

    expect(future).toEqual({ status: 'ok', data: [{ id: 1, startsAt: `${DAY}T10:00` }] })
  })

  it('el rechazo del IPC crudo es el AppError y no un Error de JavaScript', async () => {
    session = null

    const rejection = await invoke('list_appointments', { range: { from: DAY, to: DAY, resourceId: null } }).catch(
      (caught: unknown) => caught,
    )

    expect(rejection).not.toBeInstanceOf(Error)
    expect(rejection).toMatchObject({ code: 'unauthenticated' })
  })
})
