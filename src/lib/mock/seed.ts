import { addDays, addMinutes } from '@/lib/datetime'
import { usdEquivalentCents } from '@/lib/money'
import {
  PERMISSION_KEYS,
  type Appointment,
  type AppointmentStatus,
  type Client,
  type Currency,
  type Cents,
  type ExchangeRate,
  type Id,
  type LocalDate,
  type LocalDateTime,
  type Payment,
  type PaymentMethod,
  type PermissionKey,
  type Resource,
  type Service,
  type SessionUser,
} from '@/lib/model'
import type { StoreState } from './store'

export type SeedUsername = 'propietaria' | 'recepcion' | 'lectura'
export type MockUser = SessionUser
export type SeedData = StoreState & Readonly<{ appointments: readonly Appointment[]; payments: readonly Payment[] }>

const SEED_RATE_E4 = 365_000
const RATE_STEP_E4 = 500
const RATE_HISTORY_DAYS = 7
const DELETED_CLIENT_DAYS_AGO = 5
const VOID_DELAY_MIN = 30
const OWNER_USER_ID = 1
const MIDNIGHT_LIMIT_HOUR = 23

const RECEPTION_PERMISSIONS: PermissionKey[] = [
  'clients.read',
  'clients.write',
  'catalog.read',
  'appointments.read',
  'appointments.write',
  'payments.read',
  'payments.write',
  'rates.manage',
]
const READ_ONLY_PERMISSIONS: PermissionKey[] = ['clients.read', 'catalog.read', 'appointments.read', 'payments.read']

type AppointmentSpec = {
  clientId: Id
  serviceId: Id
  resourceId: Id
  day: LocalDate
  hour: number
  status: AppointmentStatus
}

type PaymentSpec = {
  appointmentIndex: number
  methodId: Id
  currency: Currency
  amountCents: Cents
  voidReason?: string
}

function buildUsers(): MockUser[] {
  return [
    { id: 1, username: 'propietaria', roleName: 'Propietaria', permissions: [...PERMISSION_KEYS] },
    { id: 2, username: 'recepcion', roleName: 'Recepción', permissions: [...RECEPTION_PERMISSIONS] },
    { id: 3, username: 'lectura', roleName: 'Solo lectura', permissions: [...READ_ONLY_PERMISSIONS] },
  ]
}

function buildClients(today: LocalDate): Client[] {
  const rows: [string, string, string, string][] = [
    ['María', 'González', 'V-12345678', '0414-1234567'],
    ['José', 'Rodríguez', 'V-14567890', '0424-2345678'],
    ['Ana', 'Pérez', 'V-16789012', '0412-3456789'],
    ['Luis', 'Martínez', 'V-18901234', '0416-4567890'],
    ['Carla', 'Hernández', 'V-20123456', '0426-5678901'],
    ['Pedro', 'Díaz', 'V-22345678', '0414-6789012'],
    ['Gabriela', 'Torres', 'E-81234567', '0424-7890123'],
    ['Sofía', 'Ramírez', 'V-24567890', '0412-8901234'],
    ['Carlos', 'Mendoza', 'V-26789012', '0416-9012345'],
  ]
  const deletedAt = `${addDays(today, -DELETED_CLIENT_DAYS_AGO)}T10:00`
  return rows.map(([firstName, lastName, nationalId, phone], index) => ({
    id: index + 1,
    firstName,
    lastName,
    nationalId,
    phone,
    deletedAt: index === rows.length - 1 ? deletedAt : null,
  }))
}

function buildServices(): Service[] {
  const rows: [string, Cents, number, boolean][] = [
    ['Limpieza facial (ejemplo)', 3_500, 60, true],
    ['Masaje relajante (ejemplo)', 4_000, 60, true],
    ['Diseño de cejas (ejemplo)', 1_000, 30, true],
    ['Manicure clásico (ejemplo)', 1_500, 45, true],
    ['Pedicure spa (ejemplo)', 2_000, 60, true],
    ['Tratamiento corporal (ejemplo)', 6_000, 90, true],
    ['Paquete 4 limpiezas faciales (ejemplo)', 12_000, 60, true],
    ['Peeling químico (ejemplo)', 5_000, 45, false],
  ]
  return rows.map(([name, priceCents, durationMin, active], index) => ({
    id: index + 1,
    name,
    priceCents,
    currency: 'USD',
    durationMin,
    active,
  }))
}

function buildResources(): Resource[] {
  return [
    { id: 1, name: 'Cabina 1', kind: 'cabin', active: true },
    { id: 2, name: 'Cabina 2', kind: 'cabin', active: true },
    { id: 3, name: 'Manicure (Rosa)', kind: 'manicure', active: false },
  ]
}

function buildPaymentMethods(): PaymentMethod[] {
  return ['Efectivo', 'Pago móvil', 'Zelle', 'Transferencia', 'Punto de venta'].map((name, index) => ({
    id: index + 1,
    name,
    active: true,
  }))
}

function buildRates(today: LocalDate): ExchangeRate[] {
  return Array.from({ length: RATE_HISTORY_DAYS }, (_, daysAgo) => ({
    date: addDays(today, -daysAgo),
    rateBsPerUsdE4: SEED_RATE_E4 - daysAgo * RATE_STEP_E4,
  }))
}

function startOfMonthOf(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`
}

function buildAppointmentSpecs(today: LocalDate): AppointmentSpec[] {
  const monthStart = startOfMonthOf(today)
  const previousMonthLastDay = addDays(monthStart, -1)
  const previousMonthStart = startOfMonthOf(previousMonthLastDay)
  const previous = (offsetDays: number) => addDays(previousMonthStart, offsetDays)
  const spec = (
    resourceId: Id,
    hour: number,
    day: LocalDate,
    clientId: Id,
    serviceId: Id,
    status: AppointmentStatus,
  ): AppointmentSpec => ({ clientId, serviceId, resourceId, day, hour, status })
  return [
    spec(1, 8, previous(4), 1, 1, 'completed'),
    spec(1, 10, previous(14), 2, 8, 'completed'),
    spec(1, 12, previous(19), 3, 1, 'cancelled'),
    spec(1, 14, monthStart, 1, 2, 'completed'),
    spec(1, 16, addDays(today, 1), 4, 1, 'scheduled'),
    spec(1, 18, addDays(today, -2), 5, 2, 'noShow'),
    spec(2, 8, previous(9), 6, 6, 'noShow'),
    spec(2, 10, previous(24), 7, 7, 'completed'),
    spec(2, 12, addDays(today, -3), 2, 6, 'completed'),
    spec(2, 14, addDays(today, -1), 3, 1, 'cancelled'),
    spec(2, 16, today, 8, 2, 'inProgress'),
    spec(2, 18, addDays(today, 2), 1, 3, 'scheduled'),
    spec(2, MIDNIGHT_LIMIT_HOUR, previousMonthLastDay, 9, 1, 'completed'),
    spec(3, 8, previous(6), 2, 4, 'completed'),
    spec(3, 10, previous(16), 7, 5, 'completed'),
    spec(3, 12, addDays(today, -2), 5, 4, 'completed'),
  ]
}

function startsAtOf(day: LocalDate, hour: number): LocalDateTime {
  return `${day}T${String(hour).padStart(2, '0')}:00`
}

function buildAppointments(today: LocalDate, services: readonly Service[]): Appointment[] {
  return buildAppointmentSpecs(today).map((spec, index) => {
    const service = services.find((candidate) => candidate.id === spec.serviceId)
    if (!service) throw new Error(`Servicio seed inexistente: ${spec.serviceId}`)
    const startsAt = startsAtOf(spec.day, spec.hour)
    return {
      id: index + 1,
      clientId: spec.clientId,
      serviceId: spec.serviceId,
      resourceId: spec.resourceId,
      startsAt,
      endsAt: addMinutes(startsAt, service.durationMin),
      status: spec.status,
      priceCentsSnapshot: service.priceCents,
      durationMinSnapshot: service.durationMin,
      notes: null,
    }
  })
}

const VOID_REASON = 'Monto digitado por error'
const VES_AMOUNT_2000_USD_CENTS = 73_000
const VES_AMOUNT_5000_USD_CENTS = 182_500

const PAYMENT_SPECS: PaymentSpec[] = [
  { appointmentIndex: 0, methodId: 1, currency: 'USD', amountCents: 3_500 },
  { appointmentIndex: 1, methodId: 2, currency: 'VES', amountCents: VES_AMOUNT_5000_USD_CENTS },
  { appointmentIndex: 3, methodId: 3, currency: 'USD', amountCents: 2_000 },
  { appointmentIndex: 3, methodId: 2, currency: 'VES', amountCents: VES_AMOUNT_2000_USD_CENTS },
  { appointmentIndex: 7, methodId: 4, currency: 'USD', amountCents: 12_000 },
  { appointmentIndex: 8, methodId: 3, currency: 'USD', amountCents: 6_000 },
  { appointmentIndex: 8, methodId: 1, currency: 'USD', amountCents: 1_000, voidReason: VOID_REASON },
  { appointmentIndex: 9, methodId: 1, currency: 'USD', amountCents: 1_500 },
  { appointmentIndex: 12, methodId: 1, currency: 'USD', amountCents: 3_500 },
  { appointmentIndex: 13, methodId: 1, currency: 'USD', amountCents: 1_500 },
  { appointmentIndex: 14, methodId: 5, currency: 'VES', amountCents: VES_AMOUNT_2000_USD_CENTS },
]

function buildPayments(appointments: readonly Appointment[]): Payment[] {
  return PAYMENT_SPECS.map((spec, index) => {
    const appointment = appointments[spec.appointmentIndex]
    if (!appointment) throw new Error(`Cita seed inexistente: ${spec.appointmentIndex}`)
    const isVes = spec.currency === 'VES'
    const isVoided = spec.voidReason !== undefined
    return {
      id: index + 1,
      appointmentId: appointment.id,
      methodId: spec.methodId,
      currency: spec.currency,
      amountCents: spec.amountCents,
      rateBsPerUsdE4: isVes ? SEED_RATE_E4 : null,
      usdEquivalentCents: isVes ? usdEquivalentCents(spec.amountCents, SEED_RATE_E4) : spec.amountCents,
      paidAt: appointment.startsAt,
      voidedAt: isVoided ? addMinutes(appointment.startsAt, VOID_DELAY_MIN) : null,
      voidedBy: isVoided ? OWNER_USER_ID : null,
      voidReason: spec.voidReason ?? null,
    }
  })
}

export function createSeed(today: LocalDate): SeedData {
  const services = buildServices()
  const appointments = buildAppointments(today, services)
  return {
    users: buildUsers(),
    sessionUserId: null,
    clients: buildClients(today),
    services,
    resources: buildResources(),
    paymentMethods: buildPaymentMethods(),
    rates: buildRates(today),
    appointments,
    payments: buildPayments(appointments),
  }
}

export function stateOf(seed: SeedData): StoreState {
  return {
    users: seed.users,
    sessionUserId: seed.sessionUserId,
    clients: seed.clients,
    services: seed.services,
    resources: seed.resources,
    paymentMethods: seed.paymentMethods,
    rates: seed.rates,
  }
}
