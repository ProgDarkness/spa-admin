import { describe, expect, it } from 'vitest'
import { addDays, dateOf, monthOf, overlaps } from '@/lib/datetime'
import { PERMISSION_KEYS, type Appointment, type AppointmentStatus } from '@/lib/model'
import { createSeed, stateOf } from './seed'

const TODAY = '2026-11-12'
const TODAYS_TO_CHECK = [TODAY, '2026-11-01', '2026-03-31', '2028-02-29', '2026-12-31']
const BLOCKING: readonly AppointmentStatus[] = ['scheduled', 'inProgress', 'completed']

describe('createSeed catálogo y recursos', () => {
  const seed = createSeed(TODAY)

  it('tiene 2 cabinas y 1 manicure, con un recurso inactivo', () => {
    expect(seed.resources.filter((resource) => resource.kind === 'cabin')).toHaveLength(2)
    expect(seed.resources.filter((resource) => resource.kind === 'manicure')).toHaveLength(1)
    expect(seed.resources.filter((resource) => !resource.active)).toHaveLength(1)
  })

  it('tiene 8 servicios USD marcados como ejemplo incluyendo 1 paquete y 1 inactivo', () => {
    expect(seed.services).toHaveLength(8)
    for (const service of seed.services) {
      expect(service.currency).toBe('USD')
      expect(service.name.toLowerCase()).toContain('ejemplo')
      expect(Number.isInteger(service.priceCents) && service.priceCents > 0).toBe(true)
      expect(service.durationMin % 5).toBe(0)
      expect(service.durationMin).toBeGreaterThan(0)
      expect(service.durationMin).toBeLessThanOrEqual(120)
    }
    expect(seed.services.filter((service) => service.name.toLowerCase().includes('paquete'))).toHaveLength(1)
    expect(seed.services.filter((service) => !service.active)).toHaveLength(1)
  })

  it('tiene 5 métodos de pago activos', () => {
    expect(seed.paymentMethods).toHaveLength(5)
    expect(seed.paymentMethods.every((method) => method.active)).toBe(true)
  })

  it('usa ids únicos por colección', () => {
    for (const rows of [seed.users, seed.clients, seed.services, seed.resources, seed.paymentMethods, seed.appointments, seed.payments]) {
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    }
  })
})

describe('createSeed usuarios y roles', () => {
  const seed = createSeed(TODAY)
  const byName = (username: string) => seed.users.find((user) => user.username === username)

  it('define propietaria, recepcion y lectura sin sesión y sin contraseñas', () => {
    expect(seed.users.map((user) => user.username)).toEqual(['propietaria', 'recepcion', 'lectura'])
    expect(seed.users.some((user) => 'password' in user)).toBe(false)
    expect(seed.sessionUserId).toBeNull()
  })

  it('referencia solo permisos válidos', () => {
    for (const user of seed.users) {
      for (const permission of user.permissions) {
        expect(PERMISSION_KEYS).toContain(permission)
      }
    }
  })

  it('propietaria tiene todos los permisos', () => {
    expect([...(byName('propietaria')?.permissions ?? [])].sort()).toEqual([...PERMISSION_KEYS].sort())
  })

  it('recepcion no gestiona recursos, métricas ni reabrir', () => {
    const permissions = byName('recepcion')?.permissions ?? []
    expect(permissions).toContain('appointments.write')
    expect(permissions).toContain('rates.manage')
    expect(permissions).not.toContain('catalog.write')
    expect(permissions).not.toContain('metrics.read')
    expect(permissions).not.toContain('appointments.reopen')
    expect(permissions).not.toContain('resources.manage')
  })

  it('lectura no tiene metrics.read ni ningún permiso de escritura', () => {
    const permissions = byName('lectura')?.permissions ?? []
    expect(permissions).not.toContain('metrics.read')
    expect(permissions.filter((permission) => /write|manage|reopen/.test(permission))).toEqual([])
    expect(permissions.length).toBeGreaterThan(0)
  })
})

describe('createSeed clientes', () => {
  const seed = createSeed(TODAY)

  it('tiene entre 8 y 10 clientes con cédula válida y única, 1 borrado', () => {
    expect(seed.clients.length).toBeGreaterThanOrEqual(8)
    expect(seed.clients.length).toBeLessThanOrEqual(10)
    for (const client of seed.clients) {
      expect(client.nationalId).toMatch(/^[VE]-\d{6,9}$/)
      expect(client.phone).not.toBe('')
    }
    expect(new Set(seed.clients.map((client) => client.nationalId)).size).toBe(seed.clients.length)
    expect(seed.clients.filter((client) => client.deletedAt !== null)).toHaveLength(1)
    expect(seed.clients.some((client) => client.nationalId.startsWith('E-'))).toBe(true)
  })
})

describe('createSeed citas', () => {
  const seed = createSeed(TODAY)

  it('referencia clientes, servicios y recursos existentes', () => {
    for (const appointment of seed.appointments) {
      expect(seed.clients.some((client) => client.id === appointment.clientId)).toBe(true)
      expect(seed.services.some((service) => service.id === appointment.serviceId)).toBe(true)
      expect(seed.resources.some((resource) => resource.id === appointment.resourceId)).toBe(true)
    }
  })

  it('endsAt es startsAt más la duración congelada y los snapshots vienen del servicio', () => {
    for (const appointment of seed.appointments) {
      const service = seed.services.find((candidate) => candidate.id === appointment.serviceId)
      const startsAtDate = new Date(`${appointment.startsAt}:00Z`).getTime()
      const endsAtDate = new Date(`${appointment.endsAt}:00Z`).getTime()
      expect((endsAtDate - startsAtDate) / 60_000).toBe(appointment.durationMinSnapshot)
      expect(appointment.durationMinSnapshot).toBe(service?.durationMin)
      expect(appointment.priceCentsSnapshot).toBe(service?.priceCents)
    }
  })

  it('cubre todos los estados', () => {
    const statuses = new Set(seed.appointments.map((appointment) => appointment.status))
    expect([...statuses].sort()).toEqual(['cancelled', 'completed', 'inProgress', 'noShow', 'scheduled'])
  })

  it('tiene citas en el mes actual y en el anterior', () => {
    const months = new Set(seed.appointments.map((appointment) => monthOf(appointment.startsAt)))
    expect(months.has('2026-11')).toBe(true)
    expect(months.has('2026-10')).toBe(true)
  })

  it('incluye una cita que cruza el límite de mes terminando a las 00:00', () => {
    const boundary = seed.appointments.find(
      (appointment) => appointment.startsAt === '2026-10-31T23:00' && appointment.endsAt === '2026-11-01T00:00',
    )
    expect(boundary?.status).toBe('completed')
  })

  it('solo las citas programadas y en curso son futuras o de hoy; las pasadas están cerradas', () => {
    for (const appointment of seed.appointments) {
      if (appointment.status === 'scheduled') expect(dateOf(appointment.startsAt) > TODAY).toBe(true)
      if (appointment.status === 'completed') expect(dateOf(appointment.startsAt) <= TODAY).toBe(true)
    }
  })

  it.each(TODAYS_TO_CHECK)('no solapa citas bloqueantes del mismo recurso (today=%s)', (today) => {
    const generated = createSeed(today)
    const blocking = generated.appointments.filter((appointment) => BLOCKING.includes(appointment.status))
    for (const [index, first] of blocking.entries()) {
      for (const second of blocking.slice(index + 1)) {
        if (first.resourceId !== second.resourceId) continue
        expect(overlaps(first, second), `${first.id} vs ${second.id}`).toBe(false)
      }
    }
  })

  it.each(TODAYS_TO_CHECK)('ninguna cita cruza medianoche más allá de las 00:00 (today=%s)', (today) => {
    for (const appointment of createSeed(today).appointments) {
      const nextMidnight = `${addDays(dateOf(appointment.startsAt), 1)}T00:00`
      expect(appointment.endsAt <= nextMidnight).toBe(true)
    }
  })

  it('las citas en recursos inactivos son pasadas', () => {
    const inactiveIds = seed.resources.filter((resource) => !resource.active).map((resource) => resource.id)
    const onInactive: Appointment[] = seed.appointments.filter((appointment) => inactiveIds.includes(appointment.resourceId))
    expect(onInactive.length).toBeGreaterThan(0)
    expect(onInactive.every((appointment) => appointment.status === 'completed')).toBe(true)
  })

  it('el cliente borrado tiene historial', () => {
    const deleted = seed.clients.find((client) => client.deletedAt !== null)
    expect(seed.appointments.some((appointment) => appointment.clientId === deleted?.id)).toBe(true)
  })
})

describe('createSeed pagos', () => {
  const seed = createSeed(TODAY)

  it('referencia citas y métodos existentes', () => {
    for (const payment of seed.payments) {
      expect(seed.appointments.some((appointment) => appointment.id === payment.appointmentId)).toBe(true)
      expect(seed.paymentMethods.some((method) => method.id === payment.methodId)).toBe(true)
    }
  })

  it('tiene pagos en USD y en VES con tasa coherente', () => {
    const usd = seed.payments.filter((payment) => payment.currency === 'USD')
    const ves = seed.payments.filter((payment) => payment.currency === 'VES')
    expect(usd.length).toBeGreaterThan(0)
    expect(ves.length).toBeGreaterThan(0)
    for (const payment of usd) {
      expect(payment.rateBsPerUsdE4).toBeNull()
      expect(payment.usdEquivalentCents).toBe(payment.amountCents)
    }
    for (const payment of ves) {
      expect(payment.rateBsPerUsdE4).not.toBeNull()
      expect(payment.usdEquivalentCents).toBeGreaterThan(0)
    }
  })

  it('tiene exactamente 1 pago anulado con motivo, autor y fecha', () => {
    const voided = seed.payments.filter((payment) => payment.voidedAt !== null)
    expect(voided).toHaveLength(1)
    expect(voided[0]?.voidReason).toBeTruthy()
    expect(voided[0]?.voidedBy).not.toBeNull()
    expect(seed.users.some((user) => user.id === voided[0]?.voidedBy)).toBe(true)
  })

  it('los pagos no anulados no traen datos de anulación', () => {
    for (const payment of seed.payments.filter((candidate) => candidate.voidedAt === null)) {
      expect(payment.voidedBy).toBeNull()
      expect(payment.voidReason).toBeNull()
    }
  })

  it('tiene exactamente 1 pago en una cita cancelada', () => {
    const cancelledIds = seed.appointments.filter((appointment) => appointment.status === 'cancelled').map((appointment) => appointment.id)
    expect(seed.payments.filter((payment) => cancelledIds.includes(payment.appointmentId))).toHaveLength(1)
  })
})

describe('createSeed tasas', () => {
  it.each(TODAYS_TO_CHECK)('trae las tasas de los últimos 7 días terminando en today=%s', (today) => {
    const { rates } = createSeed(today)
    const expectedDates = Array.from({ length: 7 }, (_, offset) => addDays(today, -offset))
    expect(rates.map((rate) => rate.date).sort()).toEqual([...expectedDates].sort())
    expect(rates.every((rate) => Number.isInteger(rate.rateBsPerUsdE4) && rate.rateBsPerUsdE4 > 0)).toBe(true)
  })
})

describe('createSeed pureza', () => {
  it('es determinista para el mismo today', () => {
    expect(createSeed(TODAY)).toEqual(createSeed(TODAY))
  })

  it('devuelve instancias independientes', () => {
    expect(createSeed(TODAY)).not.toBe(createSeed(TODAY))
    expect(createSeed(TODAY).clients).not.toBe(createSeed(TODAY).clients)
  })
})

describe('stateOf', () => {
  it('conserva el estado del store y descarta las citas y los pagos del seed', () => {
    const seed = createSeed(TODAY)

    const state = stateOf(seed)

    expect(Object.keys(state).sort()).toEqual(['clients', 'paymentMethods', 'rates', 'resources', 'services', 'sessionUserId', 'users'])
    expect(state.clients).toBe(seed.clients)
    expect(seed.appointments.length).toBeGreaterThan(0)
    expect(seed.payments.length).toBeGreaterThan(0)
  })
})
