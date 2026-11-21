import type { ServiceActivation, ServiceFilter, ServiceInput, ServiceSummary, ServiceUpdate } from '@/lib/bindings'
import type { Service, SessionUser } from '@/lib/model'
import { MAX_AMOUNT_CENTS } from '@/lib/money'
import { countCodePoints, hasDisallowedTextCharacter, normalizeDisplayText } from '@/lib/text'
import type { IpcBackend } from './auth-backend'
import { forbiddenError, unauthenticatedError, validationError } from './ipc-errors'

export type CatalogBackendOptions = {
  session: () => SessionUser | null
  services: readonly Service[]
  now?: () => number
}

const CATALOG_READ = 'catalog.read'
const CATALOG_WRITE = 'catalog.write'
const MAX_NAME_CHARS = 80
const MAX_DURATION_MIN = 1440
const DURATION_STEP_MIN = 5
const SERVICE_CURRENCY = 'USD'

type Fields = Record<string, unknown>

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null
}

function payloadOf(args: unknown, key: string): Fields {
  const payload = isRecord(args) ? args[key] : undefined
  if (!isRecord(payload)) throw new Error(`argumento inválido: ${key}`)
  return payload
}

function booleanField(fields: Fields, key: string): boolean {
  const value = fields[key]
  if (typeof value !== 'boolean') throw new Error(`argumento inválido: ${key}`)
  return value
}

function normalizedName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = normalizeDisplayText(raw)
  const length = countCodePoints(name)
  if (length < 1 || length > MAX_NAME_CHARS) return null
  return hasDisallowedTextCharacter(name) ? null : name
}

function nameKey(name: string): string {
  return name.normalize('NFKC').normalize('NFC').toLowerCase().normalize('NFC')
}

function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_AMOUNT_CENTS
}

function isDuration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_DURATION_MIN &&
    value % DURATION_STEP_MIN === 0
  )
}

function toInstant(ms: number): string {
  return new Date(ms).toISOString()
}

function asSummary(service: Service, instant: string): ServiceSummary {
  return { ...service, createdAt: instant, updatedAt: instant }
}

function replaceService(rows: readonly ServiceSummary[], updated: ServiceSummary): readonly ServiceSummary[] {
  return rows.map((row) => (row.id === updated.id ? updated : row))
}

export function createCatalogIpcBackend(next: IpcBackend, options: CatalogBackendOptions): IpcBackend {
  const now = options.now ?? Date.now
  let rows: readonly ServiceSummary[] = options.services.map((service) => asSummary(service, toInstant(now())))

  function requirePermission(...accepted: string[]): void {
    const user = options.session()
    if (!user) throw unauthenticatedError()
    if (!accepted.some((permission) => user.permissions.some((granted) => granted === permission))) {
      throw forbiddenError()
    }
  }

  function validatedInput(fields: Fields): ServiceInput {
    const name = normalizedName(fields.name)
    if (name === null) throw validationError('name')
    if (!isPrice(fields.priceCents)) throw validationError('priceCents')
    if (!isDuration(fields.durationMin)) throw validationError('durationMin')
    return { name, priceCents: fields.priceCents, durationMin: fields.durationMin }
  }

  function requireService(id: unknown): ServiceSummary {
    const found = rows.find((row) => row.id === id)
    if (!found) throw validationError('id')
    return found
  }

  function ensureNameFree(name: string, exceptId: number | null): void {
    const key = nameKey(name)
    if (rows.some((row) => row.id !== exceptId && nameKey(row.name) === key)) throw validationError('name')
  }

  function listServices(args: unknown): ServiceSummary[] {
    requirePermission(CATALOG_READ, CATALOG_WRITE)
    const filter = payloadOf(args, 'filter') as ServiceFilter
    return rows.filter((row) => filter.includeInactive || row.active)
  }

  function createService(args: unknown): ServiceSummary {
    requirePermission(CATALOG_WRITE)
    const input = validatedInput(payloadOf(args, 'input'))
    ensureNameFree(input.name, null)
    const instant = toInstant(now())
    const created: ServiceSummary = {
      id: rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1,
      ...input,
      currency: SERVICE_CURRENCY,
      active: true,
      createdAt: instant,
      updatedAt: instant,
    }
    rows = [...rows, created]
    return created
  }

  function updateService(args: unknown): ServiceSummary {
    requirePermission(CATALOG_WRITE)
    const fields = payloadOf(args, 'update') as Partial<ServiceUpdate> & Fields
    const before = requireService(fields.id)
    const input = validatedInput(fields)
    ensureNameFree(input.name, before.id)
    const changesNothing =
      before.name === input.name && before.priceCents === input.priceCents && before.durationMin === input.durationMin
    if (changesNothing) return before
    const after: ServiceSummary = { ...before, ...input, updatedAt: toInstant(now()) }
    rows = replaceService(rows, after)
    return after
  }

  function setServiceActive(args: unknown): ServiceSummary {
    requirePermission(CATALOG_WRITE)
    const fields = payloadOf(args, 'activation') as Partial<ServiceActivation> & Fields
    const active = booleanField(fields, 'active')
    const before = requireService(fields.id)
    if (before.active === active) return before
    const after: ServiceSummary = { ...before, active, updatedAt: toInstant(now()) }
    rows = replaceService(rows, after)
    return after
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    list_services: listServices,
    create_service: createService,
    update_service: updateService,
    set_service_active: setServiceActive,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
