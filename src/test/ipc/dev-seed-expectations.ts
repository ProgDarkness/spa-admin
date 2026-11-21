import { createSeed } from '@/lib/mock/seed'

const SEED_REFERENCE_DATE = '2026-11-12'
const RESOURCE_IDENTITY_KEYS = ['id', 'name', 'kind', 'active']
const SERVICE_IDENTITY_KEYS = ['id', 'name']

export const EXPECTED_DEV_RESOURCES = [
  { id: 1, name: 'Cabina 1', kind: 'cabin', active: true },
  { id: 2, name: 'Cabina 2', kind: 'cabin', active: true },
  { id: 3, name: 'Manicure (Rosa)', kind: 'manicure', active: false },
]

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
