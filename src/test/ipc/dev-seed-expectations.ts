import { createSeed } from '@/lib/mock/seed'

export const SEED_REFERENCE_DATE = '2026-11-12'
const RESOURCE_IDENTITY_KEYS = ['id', 'name', 'kind', 'active']
const SERVICE_IDENTITY_KEYS = ['id', 'name']
const PAYMENT_METHOD_IDENTITY_KEYS = ['id', 'name', 'active']
const RATE_IDENTITY_KEYS = ['date', 'rateBsPerUsdE4']
const APPOINTMENT_IDENTITY_KEYS = [
  'id',
  'clientId',
  'serviceId',
  'resourceId',
  'startsAt',
  'endsAt',
  'status',
  'priceCentsSnapshot',
  'durationMinSnapshot',
  'notes',
]
const PAYMENT_IDENTITY_KEYS = [
  'id',
  'appointmentId',
  'methodId',
  'currency',
  'amountCents',
  'rateBsPerUsdE4',
  'usdEquivalentCents',
  'voidReason',
]
const CLIENT_IDENTITY_KEYS = ['id', 'firstName', 'lastName', 'nationalId', 'phone']

export const EXPECTED_DEV_RESOURCES = [
  { id: 1, name: 'Cabina 1', kind: 'cabin', active: true },
  { id: 2, name: 'Cabina 2', kind: 'cabin', active: true },
  { id: 3, name: 'Manicure (Rosa)', kind: 'manicure', active: false },
]

export const EXPECTED_DEV_PAYMENT_METHODS = [
  { id: 1, name: 'Efectivo', active: true },
  { id: 2, name: 'Pago móvil', active: true },
  { id: 5, name: 'Punto de venta', active: true },
  { id: 4, name: 'Transferencia', active: true },
  { id: 3, name: 'Zelle', active: true },
]

export const EXPECTED_DEV_RATES = createSeed(SEED_REFERENCE_DATE).rates

export const EXPECTED_DEV_CLIENTS = createSeed(SEED_REFERENCE_DATE).clients.map(
  ({ id, firstName, lastName, nationalId, phone, deletedAt }) => ({
    id,
    firstName,
    lastName,
    nationalId,
    phone,
    deleted: deletedAt !== null,
  }),
)

export const EXPECTED_DEV_APPOINTMENTS = createSeed(SEED_REFERENCE_DATE).appointments

const SEED_RATE_E4 = 365_000
const SEED_VOID_REASON = 'Monto digitado por error'

type ExpectedPayment = {
  id: number
  appointmentId: number
  methodId: number
  currency: 'USD' | 'VES'
  amountCents: number
  rateBsPerUsdE4: number | null
  usdEquivalentCents: number
  voidReason: string | null
}

function expectedPayment(
  id: number,
  appointmentId: number,
  methodId: number,
  currency: 'USD' | 'VES',
  amountCents: number,
  usdEquivalentCents: number,
  voidReason: string | null = null,
): ExpectedPayment {
  const rateBsPerUsdE4 = currency === 'VES' ? SEED_RATE_E4 : null
  return { id, appointmentId, methodId, currency, amountCents, rateBsPerUsdE4, usdEquivalentCents, voidReason }
}

export const EXPECTED_DEV_PAYMENTS: readonly ExpectedPayment[] = [
  expectedPayment(1, 1, 1, 'USD', 3_500, 3_500),
  expectedPayment(2, 2, 2, 'VES', 182_500, 5_000),
  expectedPayment(3, 4, 3, 'USD', 2_000, 2_000),
  expectedPayment(4, 4, 2, 'VES', 73_000, 2_000),
  expectedPayment(5, 8, 4, 'USD', 12_000, 12_000),
  expectedPayment(6, 9, 3, 'USD', 6_000, 6_000),
  expectedPayment(7, 9, 1, 'USD', 1_000, 1_000, SEED_VOID_REASON),
  expectedPayment(8, 10, 1, 'USD', 1_500, 1_500),
  expectedPayment(9, 13, 1, 'USD', 3_500, 3_500),
  expectedPayment(10, 14, 1, 'USD', 1_500, 1_500),
  expectedPayment(11, 15, 5, 'VES', 73_000, 2_000),
]

export const EXPECTED_DEV_SERVICES = createSeed(SEED_REFERENCE_DATE).services.map(({ id, name }) => ({ id, name }))

function project(rows: unknown, keys: readonly string[]): unknown[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => Object.fromEntries(keys.map((key) => [key, Reflect.get(row, key)])))
}

export function resourceIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, RESOURCE_IDENTITY_KEYS)
}

export function clientIdentitiesOf(rows: unknown): unknown[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => ({
    ...Object.fromEntries(CLIENT_IDENTITY_KEYS.map((key) => [key, Reflect.get(row, key)])),
    deleted: Reflect.get(row, 'deletedAt') !== null,
  }))
}

export function appointmentIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, APPOINTMENT_IDENTITY_KEYS)
}

export function serviceIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, SERVICE_IDENTITY_KEYS)
}

export function paymentIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, PAYMENT_IDENTITY_KEYS)
}

export function paymentMethodIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, PAYMENT_METHOD_IDENTITY_KEYS)
}

export function rateIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, RATE_IDENTITY_KEYS)
}
