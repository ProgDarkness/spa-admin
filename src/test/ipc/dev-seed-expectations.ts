import { createSeed } from '@/lib/mock/seed'

export const SEED_REFERENCE_DATE = '2026-11-12'
const RESOURCE_IDENTITY_KEYS = ['id', 'name', 'kind', 'active']
const SERVICE_IDENTITY_KEYS = ['id', 'name']
const PAYMENT_METHOD_IDENTITY_KEYS = ['id', 'name', 'active']
const RATE_IDENTITY_KEYS = ['date', 'rateBsPerUsdE4']

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

export const EXPECTED_DEV_SERVICES = createSeed(SEED_REFERENCE_DATE).services.map(({ id, name }) => ({ id, name }))

function project(rows: unknown, keys: readonly string[]): unknown[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => Object.fromEntries(keys.map((key) => [key, Reflect.get(row, key)])))
}

export function resourceIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, RESOURCE_IDENTITY_KEYS)
}

export function serviceIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, SERVICE_IDENTITY_KEYS)
}

export function paymentMethodIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, PAYMENT_METHOD_IDENTITY_KEYS)
}

export function rateIdentitiesOf(rows: unknown): unknown[] {
  return project(rows, RATE_IDENTITY_KEYS)
}
