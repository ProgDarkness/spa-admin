import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  commands,
  type AppointmentInput,
  type AppointmentSummary,
  type AppointmentTransition,
  type ClientSummary,
  type ResourceSummary,
  type ServiceSummary,
} from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { Appointment, PermissionKey, SessionUser } from '@/lib/model'
import { createAppointmentsIpcBackend } from './appointments-backend'
import { createSharedRows, type SharedRows } from './shared-rows'

const SEED = createSeed('2026-11-12')
const NOW_MS = new Date(2026, 10, 12, 9, 0, 30).getTime()
const DAY = '2026-11-13'
const PAST_DAY = '2026-11-10'
const INSTANT = '2026-11-12T09:00:00.000Z'
const FACIAL_ID = 1
const INACTIVE_SERVICE_ID = 8
const CABIN_ONE = 1
const CABIN_TWO = 2
const INACTIVE_RESOURCE = 3
const DELETED_CLIENT = 9
const MISSING = 999

const ALL_PERMISSIONS: PermissionKey[] = ['appointments.read', 'appointments.write', 'appointments.reopen']

let session: SessionUser | null
let clients: SharedRows<ClientSummary>
let services: SharedRows<ServiceSummary>
let resources: SharedRows<ResourceSummary>
let published: SharedRows<AppointmentSummary>

function userWith(...permissions: PermissionKey[]): SessionUser {
  return { id: 50, username: 'tester', roleName: 'Prueba', permissions }
}

function row(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 100,
    clientId: 2,
    serviceId: FACIAL_ID,
    resourceId: CABIN_ONE,
    startsAt: `${DAY}T10:00`,
    endsAt: `${DAY}T11:00`,
    status: 'scheduled',
    priceCentsSnapshot: 3_500,
    durationMinSnapshot: 60,
    notes: null,
    ...overrides,
  }
}

function input(overrides: Partial<AppointmentInput> = {}): AppointmentInput {
  return { clientId: 1, serviceId: FACIAL_ID, resourceId: CABIN_ONE, startsAt: `${DAY}T12:00`, notes: null, ...overrides }
}

function install(initial: readonly Appointment[] = []): void {
  clients = createSharedRows(SEED.clients)
  services = createSharedRows(
    SEED.services.map((service): ServiceSummary => ({ ...service, currency: 'USD', createdAt: INSTANT, updatedAt: INSTANT })),
  )
  resources = createSharedRows(SEED.resources.map((resource) => ({ ...resource, createdAt: INSTANT, updatedAt: INSTANT })))
  published = createSharedRows()
  mockIPC(
    createAppointmentsIpcBackend(
      (command) => {
        throw new Error(`IPC no simulado: ${command}`)
      },
      { session: () => session, appointments: initial, clients, services, resources, shared: published, now: () => NOW_MS },
    ),
  )
}

beforeEach(() => {
  session = userWith(...ALL_PERMISSIONS)
  install()
})

afterEach(() => clearMocks())

function dataOf<T>(outcome: { status: 'ok'; data: T } | { status: 'error'; error: unknown }): T {
  if (outcome.status !== 'ok') throw new Error(`se esperaba ok: ${JSON.stringify(outcome.error)}`)
  return outcome.data
}

const range = (from: string, to: string, resourceId: number | null = null) => ({ from, to, resourceId })

describe('autorización', () => {
  it('rechaza todos los comandos sin sesión con unauthenticated', async () => {
    session = null
    install([row()])
    const outcomes = [
      await commands.listAppointments(range(DAY, DAY)),
      await commands.createAppointment(input()),
      await commands.moveAppointment({ id: 100, startsAt: `${DAY}T12:00`, resourceId: CABIN_ONE }),
      await commands.transitionAppointment({ id: 100, transition: 'start' }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } }))
  })

  it('permite leer con solo appointments.read y con solo appointments.write', async () => {
    session = userWith('appointments.read')
    expect(await commands.listAppointments(range(DAY, DAY))).toMatchObject({ status: 'ok' })
    session = userWith('appointments.write')
    expect(await commands.listAppointments(range(DAY, DAY))).toMatchObject({ status: 'ok' })
  })

  it('rechaza leer sin ninguno de los dos permisos con forbidden', async () => {
    session = userWith('clients.read')

    expect(await commands.listAppointments(range(DAY, DAY))).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('el usuario de solo lectura no puede escribir', async () => {
    session = userWith('appointments.read')
    install([row()])

    const outcomes = [
      await commands.createAppointment(input()),
      await commands.moveAppointment({ id: 100, startsAt: `${DAY}T12:00`, resourceId: CABIN_ONE }),
      await commands.transitionAppointment({ id: 100, transition: 'cancel' }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'forbidden' } }))
  })

  it('reabrir exige appointments.reopen además de write y las demás transiciones no', async () => {
    session = userWith('appointments.read', 'appointments.write')
    install([row({ status: 'cancelled' }), row({ id: 101, startsAt: `${DAY}T14:00`, endsAt: `${DAY}T15:00` })])

    const reopen = await commands.transitionAppointment({ id: 100, transition: 'reopen' })
    const cancel = await commands.transitionAppointment({ id: 101, transition: 'cancel' })

    expect(reopen).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(cancel).toMatchObject({ status: 'ok' })
  })
})

describe('listAppointments', () => {
  it('rechaza from inválido con validation sobre from', async () => {
    expect(await commands.listAppointments(range('13/11/2026', DAY))).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'from' },
    })
    expect(await commands.listAppointments(range('2026-02-30', DAY))).toMatchObject({ error: { field: 'from' } })
  })

  it('rechaza to inválido, anterior a from o más allá de 366 días con validation sobre to', async () => {
    const invalid = await commands.listAppointments(range(DAY, 'mañana'))
    const inverted = await commands.listAppointments(range('2026-11-14', DAY))
    const tooWide = await commands.listAppointments(range('2026-01-01', '2027-01-02'))
    const widest = await commands.listAppointments(range('2026-01-01', '2027-01-01'))

    expect(invalid).toMatchObject({ error: { code: 'validation', field: 'to' } })
    expect(inverted).toMatchObject({ error: { code: 'validation', field: 'to' } })
    expect(tooWide).toMatchObject({ error: { code: 'validation', field: 'to' } })
    expect(widest).toMatchObject({ status: 'ok' })
  })

  it('rechaza un resourceId no positivo con validation sobre resourceId', async () => {
    expect(await commands.listAppointments(range(DAY, DAY, 0))).toMatchObject({
      error: { code: 'validation', field: 'resourceId' },
    })
  })

  it('incluye los bordes por fecha de inicio, filtra por recurso y ordena por inicio e id', async () => {
    install([
      row({ id: 5, startsAt: '2026-11-14T09:00', endsAt: '2026-11-14T10:00' }),
      row({ id: 4, startsAt: `${DAY}T10:00` }),
      row({ id: 3, startsAt: `${DAY}T10:00`, endsAt: `${DAY}T11:00`, resourceId: CABIN_TWO }),
      row({ id: 2, startsAt: '2026-11-12T23:00', endsAt: '2026-11-13T00:00' }),
      row({ id: 1, startsAt: '2026-11-15T09:00', endsAt: '2026-11-15T10:00' }),
    ])

    const everyone = dataOf(await commands.listAppointments(range('2026-11-13', '2026-11-14')))
    const cabinTwo = dataOf(await commands.listAppointments(range('2026-11-13', '2026-11-14', CABIN_TWO)))

    expect(everyone.map((appointment) => appointment.id)).toEqual([3, 4, 5])
    expect(cabinTwo.map((appointment) => appointment.id)).toEqual([3])
  })
})

describe('createAppointment', () => {
  it('crea con snapshots del servicio, fin calculado, estado scheduled y notas recortadas', async () => {
    const created = dataOf(await commands.createAppointment(input({ notes: '  traer bata  ' })))

    expect(created).toEqual({
      id: 1,
      clientId: 1,
      serviceId: FACIAL_ID,
      resourceId: CABIN_ONE,
      startsAt: `${DAY}T12:00`,
      endsAt: `${DAY}T13:00`,
      status: 'scheduled',
      priceCentsSnapshot: 3_500,
      durationMinSnapshot: 60,
      notes: 'traer bata',
    })
  })

  it('asigna ids consecutivos y publica las filas en el estado compartido', async () => {
    install([row({ id: 7 })])

    const created = dataOf(await commands.createAppointment(input()))

    expect(created.id).toBe(8)
    expect(published.read().map((appointment) => appointment.id)).toEqual([7, 8])
  })

  it('guarda notas vacías o en blanco como null', async () => {
    expect(dataOf(await commands.createAppointment(input({ notes: '   ' }))).notes).toBeNull()
  })

  it('permite crear en el pasado', async () => {
    expect(await commands.createAppointment(input({ startsAt: `${PAST_DAY}T10:00` }))).toMatchObject({ status: 'ok' })
  })

  it('valida ids no positivos, hora no múltiplo de 5 y formato con validation', async () => {
    const outcomes = [
      await commands.createAppointment(input({ clientId: 0 })),
      await commands.createAppointment(input({ serviceId: -1 })),
      await commands.createAppointment(input({ resourceId: 0 })),
      await commands.createAppointment(input({ startsAt: `${DAY}T12:03` })),
      await commands.createAppointment(input({ startsAt: `${DAY}T25:00` })),
      await commands.createAppointment(input({ startsAt: '2026-02-30T10:00' })),
    ]

    expect(outcomes.map((outcome) => outcome.status === 'error' && [outcome.error.code, outcome.error.field])).toEqual([
      ['validation', 'clientId'],
      ['validation', 'serviceId'],
      ['validation', 'resourceId'],
      ['validation', 'startsAt'],
      ['validation', 'startsAt'],
      ['validation', 'startsAt'],
    ])
  })

  it('rechaza notas de más de 500 caracteres o con caracteres de control y acepta 500', async () => {
    const tooLong = await commands.createAppointment(input({ notes: 'a'.repeat(501) }))
    const control = await commands.createAppointment(input({ notes: 'a\u0007b' }))
    const limit = await commands.createAppointment(input({ notes: 'a'.repeat(500) }))

    expect(tooLong).toMatchObject({ error: { code: 'validation', field: 'notes' } })
    expect(control).toMatchObject({ error: { code: 'validation', field: 'notes' } })
    expect(limit).toMatchObject({ status: 'ok' })
  })

  it('un cliente inexistente o eliminado es notFound sobre clientId', async () => {
    const missing = await commands.createAppointment(input({ clientId: MISSING }))
    const deleted = await commands.createAppointment(input({ clientId: DELETED_CLIENT }))

    expect(missing).toMatchObject({ error: { code: 'notFound', field: 'clientId', message: 'El cliente no existe' } })
    expect(deleted).toMatchObject({ error: { code: 'notFound', field: 'clientId' } })
  })

  it('respeta el orden de errores: servicio y recurso inexistentes antes que servicio o recurso inactivo', async () => {
    const missingService = await commands.createAppointment(input({ serviceId: MISSING }))
    const missingResourceWithInactiveService = await commands.createAppointment(
      input({ serviceId: INACTIVE_SERVICE_ID, resourceId: MISSING }),
    )
    const inactiveServiceAndResource = await commands.createAppointment(
      input({ serviceId: INACTIVE_SERVICE_ID, resourceId: INACTIVE_RESOURCE }),
    )
    const inactiveResource = await commands.createAppointment(input({ resourceId: INACTIVE_RESOURCE }))

    expect(missingService).toMatchObject({ error: { code: 'notFound', field: 'serviceId' } })
    expect(missingResourceWithInactiveService).toMatchObject({ error: { code: 'notFound', field: 'resourceId' } })
    expect(inactiveServiceAndResource).toMatchObject({ error: { code: 'validation', field: 'serviceId' } })
    expect(inactiveResource).toMatchObject({ error: { code: 'resourceInactive', field: 'resourceId' } })
  })

  it('termina justo a medianoche con 23:00 más 60 y rechaza 23:30 más 60 con crossesMidnight', async () => {
    const exact = dataOf(await commands.createAppointment(input({ startsAt: `${DAY}T23:00` })))
    const beyond = await commands.createAppointment(input({ startsAt: `${DAY}T23:30`, resourceId: CABIN_TWO }))

    expect(exact.endsAt).toBe('2026-11-14T00:00')
    expect(beyond).toMatchObject({ status: 'error', error: { code: 'crossesMidnight', field: 'startsAt' } })
  })

  it('rechaza el solape con overlap y los ids de las citas en conflicto', async () => {
    install([row({ id: 10 }), row({ id: 11, startsAt: `${DAY}T11:00`, endsAt: `${DAY}T12:00` })])

    const outcome = await commands.createAppointment(input({ startsAt: `${DAY}T10:30` }))

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'overlap', field: 'startsAt', entityIds: [10, 11] } })
  })

  it('fin igual al inicio contiguo no solapa y otro recurso no choca', async () => {
    install([row({ id: 10 })])

    const after = await commands.createAppointment(input({ startsAt: `${DAY}T11:00` }))
    const before = await commands.createAppointment(input({ startsAt: `${DAY}T09:00` }))
    const otherResource = await commands.createAppointment(input({ startsAt: `${DAY}T10:00`, resourceId: CABIN_TWO }))

    expect([after.status, before.status, otherResource.status]).toEqual(['ok', 'ok', 'ok'])
  })

  it('las citas canceladas o no asistidas liberan el hueco y las demás lo bloquean', async () => {
    install([
      row({ id: 10, status: 'cancelled' }),
      row({ id: 11, status: 'noShow', startsAt: `${DAY}T13:00`, endsAt: `${DAY}T14:00` }),
      row({ id: 12, status: 'completed', startsAt: `${DAY}T15:00`, endsAt: `${DAY}T16:00` }),
      row({ id: 13, status: 'inProgress', startsAt: `${DAY}T17:00`, endsAt: `${DAY}T18:00` }),
    ])

    const cancelledSlot = await commands.createAppointment(input({ startsAt: `${DAY}T10:00` }))
    const noShowSlot = await commands.createAppointment(input({ startsAt: `${DAY}T13:00` }))
    const completedSlot = await commands.createAppointment(input({ startsAt: `${DAY}T15:00` }))
    const inProgressSlot = await commands.createAppointment(input({ startsAt: `${DAY}T17:00` }))

    expect([cancelledSlot.status, noShowSlot.status]).toEqual(['ok', 'ok'])
    expect(completedSlot).toMatchObject({ error: { code: 'overlap', entityIds: [12] } })
    expect(inProgressSlot).toMatchObject({ error: { code: 'overlap', entityIds: [13] } })
  })

  it('usa el precio y la duración vigentes del servicio al crear y no altera citas existentes', async () => {
    const first = dataOf(await commands.createAppointment(input()))
    services.write(services.read().map((service) => (service.id === FACIAL_ID ? { ...service, priceCents: 9_900, durationMin: 30 } : service)))

    const second = dataOf(await commands.createAppointment(input({ startsAt: `${DAY}T15:00` })))

    expect(first).toMatchObject({ priceCentsSnapshot: 3_500, durationMinSnapshot: 60 })
    expect(second).toMatchObject({ priceCentsSnapshot: 9_900, durationMinSnapshot: 30, endsAt: `${DAY}T15:30` })
    expect(published.read().find((appointment) => appointment.id === first.id)).toMatchObject({ priceCentsSnapshot: 3_500 })
  })
})

describe('moveAppointment', () => {
  const move = (id: number, startsAt: string, resourceId: number) => commands.moveAppointment({ id, startsAt, resourceId })

  it('mueve conservando la duración congelada', async () => {
    install([row({ durationMinSnapshot: 45, endsAt: `${DAY}T10:45` })])

    const moved = dataOf(await move(100, `${DAY}T14:00`, CABIN_TWO))

    expect(moved).toMatchObject({ resourceId: CABIN_TWO, startsAt: `${DAY}T14:00`, endsAt: `${DAY}T14:45` })
  })

  it('mover a su propio hueco es un no-op que devuelve la cita intacta', async () => {
    install([row()])

    const same = dataOf(await move(100, `${DAY}T10:00`, CABIN_ONE))

    expect(same).toEqual(row())
  })

  it('solo mueve citas scheduled y responde invalidTransition en los demás estados', async () => {
    install([row({ id: 100, status: 'inProgress' }), row({ id: 101, status: 'cancelled', startsAt: `${DAY}T15:00`, endsAt: `${DAY}T16:00` })])

    const inProgress = await move(100, `${DAY}T12:00`, CABIN_ONE)
    const cancelled = await move(101, `${DAY}T12:00`, CABIN_ONE)

    expect(inProgress).toMatchObject({ error: { code: 'invalidTransition' } })
    expect(cancelled).toMatchObject({ error: { code: 'invalidTransition' } })
  })

  it('cita inexistente es notFound sin campo y valida recurso e inicio antes de buscarla', async () => {
    const missing = await move(MISSING, `${DAY}T12:00`, CABIN_ONE)
    const badStart = await move(MISSING, `${DAY}T12:02`, CABIN_ONE)
    const badResource = await move(MISSING, `${DAY}T12:00`, 0)

    expect(missing).toMatchObject({ error: { code: 'notFound', field: null, message: 'La cita no existe' } })
    expect(badStart).toMatchObject({ error: { code: 'validation', field: 'startsAt' } })
    expect(badResource).toMatchObject({ error: { code: 'validation', field: 'resourceId' } })
  })

  it('recurso destino inexistente es notFound y recurso inactivo es resourceInactive', async () => {
    install([row()])

    const missing = await move(100, `${DAY}T12:00`, MISSING)
    const inactive = await move(100, `${DAY}T12:00`, INACTIVE_RESOURCE)

    expect(missing).toMatchObject({ error: { code: 'notFound', field: 'resourceId' } })
    expect(inactive).toMatchObject({ error: { code: 'resourceInactive', field: 'resourceId' } })
  })

  it('rechaza cruzar medianoche y el solape con otra cita pero ignora la propia', async () => {
    install([row(), row({ id: 101, startsAt: `${DAY}T12:00`, endsAt: `${DAY}T13:00` })])

    const crossing = await move(100, `${DAY}T23:30`, CABIN_ONE)
    const overlapping = await move(100, `${DAY}T12:30`, CABIN_ONE)
    const overOwnOldSlot = await move(100, `${DAY}T10:30`, CABIN_ONE)

    expect(crossing).toMatchObject({ error: { code: 'crossesMidnight', field: 'startsAt' } })
    expect(overlapping).toMatchObject({ error: { code: 'overlap', entityIds: [101] } })
    expect(overOwnOldSlot).toMatchObject({ status: 'ok' })
  })

  it('el cambio se refleja en el estado compartido', async () => {
    install([row()])

    await move(100, `${DAY}T14:00`, CABIN_ONE)

    expect(published.read()[0]).toMatchObject({ startsAt: `${DAY}T14:00` })
  })
})

describe('transitionAppointment', () => {
  const transition = (id: number, kind: AppointmentTransition) => commands.transitionAppointment({ id, transition: kind })
  const statusAfterOf = async (status: Appointment['status'], kind: AppointmentTransition) => {
    install([row({ status, startsAt: `${PAST_DAY}T10:00`, endsAt: `${PAST_DAY}T11:00` })])
    const outcome = await transition(100, kind)
    return outcome.status === 'ok' ? outcome.data.status : outcome.error.code
  }

  it('cubre la tabla completa de transiciones', async () => {
    const table: [Appointment['status'], AppointmentTransition, string][] = [
      ['scheduled', 'start', 'inProgress'],
      ['scheduled', 'complete', 'completed'],
      ['scheduled', 'markNoShow', 'noShow'],
      ['scheduled', 'cancel', 'cancelled'],
      ['scheduled', 'reopen', 'invalidTransition'],
      ['inProgress', 'start', 'invalidTransition'],
      ['inProgress', 'complete', 'completed'],
      ['inProgress', 'markNoShow', 'invalidTransition'],
      ['inProgress', 'cancel', 'cancelled'],
      ['inProgress', 'reopen', 'invalidTransition'],
      ['completed', 'start', 'invalidTransition'],
      ['completed', 'complete', 'invalidTransition'],
      ['completed', 'cancel', 'invalidTransition'],
      ['completed', 'reopen', 'scheduled'],
      ['cancelled', 'reopen', 'scheduled'],
      ['noShow', 'reopen', 'scheduled'],
      ['cancelled', 'cancel', 'invalidTransition'],
      ['noShow', 'markNoShow', 'invalidTransition'],
    ]

    const results: string[] = []
    for (const [from, kind] of table) results.push(await statusAfterOf(from, kind))

    expect(results).toEqual(table.map(([, , expected]) => expected))
  })

  it('completar desde scheduled exige que la hora de inicio ya haya pasado', async () => {
    install([
      row({ id: 100, startsAt: '2026-11-12T09:00', endsAt: '2026-11-12T10:00' }),
      row({ id: 101, startsAt: '2026-11-12T09:05', endsAt: '2026-11-12T10:05', resourceId: CABIN_TWO }),
    ])

    const atStart = await transition(100, 'complete')
    const beforeStart = await transition(101, 'complete')

    expect(atStart).toMatchObject({ status: 'ok', data: { status: 'completed' } })
    expect(beforeStart).toMatchObject({ error: { code: 'invalidTransition' } })
  })

  it('cita inexistente es notFound sin campo', async () => {
    expect(await transition(MISSING, 'start')).toMatchObject({ error: { code: 'notFound', field: null } })
  })

  it('reabrir revalida el solape y responde overlap con los ids', async () => {
    install([
      row({ id: 100, status: 'cancelled' }),
      row({ id: 101, startsAt: `${DAY}T10:30`, endsAt: `${DAY}T11:30` }),
    ])

    expect(await transition(100, 'reopen')).toMatchObject({ error: { code: 'overlap', entityIds: [101] } })
  })

  it('reabrir una cita futura en recurso inactivo es resourceInactive y una ya terminada se permite', async () => {
    install([
      row({ id: 100, status: 'cancelled', resourceId: INACTIVE_RESOURCE }),
      row({
        id: 101,
        status: 'completed',
        resourceId: INACTIVE_RESOURCE,
        startsAt: `${PAST_DAY}T10:00`,
        endsAt: `${PAST_DAY}T11:00`,
      }),
    ])

    const future = await transition(100, 'reopen')
    const finished = await transition(101, 'reopen')

    expect(future).toMatchObject({ error: { code: 'resourceInactive', field: 'resourceId' } })
    expect(finished).toMatchObject({ status: 'ok', data: { status: 'scheduled' } })
  })

  it('el cambio de estado se refleja en el estado compartido', async () => {
    install([row()])

    await transition(100, 'start')

    expect(published.read()[0]).toMatchObject({ status: 'inProgress' })
  })

  it('un nombre de transición desconocido falla como argumento inválido', async () => {
    install([row()])

    await expect(
      commands.transitionAppointment({ id: 100, transition: 'explode' as AppointmentTransition }),
    ).rejects.toThrow('argumento inválido')
  })

  it('decide la sesión y el permiso antes de validar los argumentos', async () => {
    install([row()])
    const malformed = { id: 'x', transition: 'explode' } as never

    session = null
    const anonymous = await commands.transitionAppointment(malformed)
    session = userWith('appointments.read')
    const readOnly = await commands.transitionAppointment(malformed)

    expect(anonymous).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
    expect(readOnly).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })
})

describe('validación de entradas', () => {
  it('acepta inicios 00:00, 23:55 con cruce de medianoche reportado aparte y el 29 de febrero bisiesto', async () => {
    const midnight = await commands.createAppointment(input({ startsAt: `${DAY}T00:00` }))
    const lastStep = await commands.createAppointment(input({ startsAt: `${DAY}T23:55`, resourceId: CABIN_TWO }))
    const leapDay = await commands.createAppointment(input({ startsAt: '2028-02-29T10:00' }))

    expect(midnight).toMatchObject({ status: 'ok' })
    expect(lastStep).toMatchObject({ error: { code: 'crossesMidnight' } })
    expect(leapDay).toMatchObject({ status: 'ok' })
  })

  it('rechaza ids decimales y notas que no son texto con validation', async () => {
    const decimalClient = await commands.createAppointment(input({ clientId: 1.5 }))
    const decimalRange = await commands.listAppointments(range(DAY, DAY, 1.5))
    const numericNotes = await commands.createAppointment(input({ notes: 5 as never }))

    expect(decimalClient).toMatchObject({ error: { code: 'validation', field: 'clientId' } })
    expect(decimalRange).toMatchObject({ error: { code: 'validation', field: 'resourceId' } })
    expect(numericNotes).toMatchObject({ error: { code: 'validation', field: 'notes' } })
  })

  it('mover a su propio hueco en un recurso inactivo es un no-op y a otro hueco es resourceInactive', async () => {
    install([row({ resourceId: INACTIVE_RESOURCE })])

    const same = dataOf(await commands.moveAppointment({ id: 100, startsAt: `${DAY}T10:00`, resourceId: INACTIVE_RESOURCE }))
    const elsewhere = await commands.moveAppointment({ id: 100, startsAt: `${DAY}T12:00`, resourceId: INACTIVE_RESOURCE })

    expect(same).toEqual(row({ resourceId: INACTIVE_RESOURCE }))
    expect(elsewhere).toMatchObject({ error: { code: 'resourceInactive' } })
  })
})
