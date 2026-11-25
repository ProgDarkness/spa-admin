import type {
  AppointmentSummary,
  FutureAppointment,
  ResourceInput,
  ResourceKind,
  ResourceSummary,
} from '@/lib/bindings'
import { toLocalDateTime } from '@/lib/datetime'
import type { Resource, SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import { resourceHasFutureAppointmentsError, validationError } from './ipc-errors'
import type { SharedRows } from './shared-rows'
import {
  booleanField,
  isRecord,
  nextRecordId,
  normalizedRecordName,
  payloadOf,
  recordNameKey,
  replaceRecord,
  requirePermission,
  toInstant,
  type Fields,
} from './record-backend-support'

export type ResourcesBackendOptions = {
  session: () => SessionUser | null
  resources: readonly Resource[]
  appointments: SharedRows<AppointmentSummary>
  shared?: SharedRows<ResourceSummary>
  now?: () => number
}

const APPOINTMENTS_READ = 'appointments.read'
const RESOURCES_MANAGE = 'resources.manage'
const RESOURCE_KINDS: readonly unknown[] = ['cabin', 'manicure'] satisfies readonly ResourceKind[]

function isResourceKind(value: unknown): value is ResourceKind {
  return RESOURCE_KINDS.includes(value)
}

function asSummary(resource: Resource, instant: string): ResourceSummary {
  return { ...resource, createdAt: instant, updatedAt: instant }
}

export function createResourcesIpcBackend(next: IpcBackend, options: ResourcesBackendOptions): IpcBackend {
  const now = options.now ?? Date.now
  let rows: readonly ResourceSummary[] = options.resources.map((resource) => asSummary(resource, toInstant(now())))
  options.shared?.write(rows)

  function setRows(updated: readonly ResourceSummary[]): void {
    rows = updated
    options.shared?.write(updated)
  }

  function validatedInput(fields: Fields): ResourceInput {
    const name = normalizedRecordName(fields.name)
    if (name === null) throw validationError('name')
    if (!isResourceKind(fields.kind)) throw validationError('kind')
    return { name, kind: fields.kind }
  }

  function requireResource(id: unknown): ResourceSummary {
    const found = rows.find((row) => row.id === id)
    if (!found) throw validationError('id')
    return found
  }

  function ensureNameFree(name: string, exceptId: number | null): void {
    const key = recordNameKey(name)
    if (rows.some((row) => row.id !== exceptId && recordNameKey(row.name) === key)) throw validationError('name')
  }

  function listResources(args: unknown): ResourceSummary[] {
    requirePermission(options.session, APPOINTMENTS_READ, RESOURCES_MANAGE)
    const filter = payloadOf(args, 'filter')
    if (typeof filter.includeInactive !== 'boolean') throw validationError('includeInactive')
    const includeInactive = filter.includeInactive
    return rows.filter((row) => includeInactive || row.active)
  }

  function createResource(args: unknown): ResourceSummary {
    requirePermission(options.session, RESOURCES_MANAGE)
    const input = validatedInput(payloadOf(args, 'input'))
    ensureNameFree(input.name, null)
    const instant = toInstant(now())
    const created: ResourceSummary = {
      id: nextRecordId(rows),
      ...input,
      active: true,
      createdAt: instant,
      updatedAt: instant,
    }
    setRows([...rows, created])
    return created
  }

  function updateResource(args: unknown): ResourceSummary {
    requirePermission(options.session, RESOURCES_MANAGE)
    const fields = payloadOf(args, 'update')
    const before = requireResource(fields.id)
    const input = validatedInput(fields)
    ensureNameFree(input.name, before.id)
    if (before.name === input.name && before.kind === input.kind) return before
    const after: ResourceSummary = { ...before, ...input, updatedAt: toInstant(now()) }
    setRows(replaceRecord(rows, after))
    return after
  }

  function futureScheduledOf(resourceId: number): AppointmentSummary[] {
    const currentMinute = toLocalDateTime(new Date(now()))
    return options.appointments.read()
      .filter((row) => row.resourceId === resourceId && row.status === 'scheduled' && row.endsAt > currentMinute)
      .toSorted((first, second) => first.startsAt.localeCompare(second.startsAt) || first.id - second.id)
  }

  function setResourceActive(args: unknown): ResourceSummary {
    requirePermission(options.session, RESOURCES_MANAGE)
    const fields = payloadOf(args, 'activation')
    const active = booleanField(fields, 'active')
    const before = requireResource(fields.id)
    if (before.active === active) return before
    const blocking = active ? [] : futureScheduledOf(before.id)
    if (blocking.length > 0) throw resourceHasFutureAppointmentsError(blocking.map((row) => row.id))
    const after: ResourceSummary = { ...before, active, updatedAt: toInstant(now()) }
    setRows(replaceRecord(rows, after))
    return after
  }

  function listFutureAppointmentsOfResource(args: unknown): FutureAppointment[] {
    requirePermission(options.session, RESOURCES_MANAGE)
    const resource = requireResource(isRecord(args) ? args.id : undefined)
    return futureScheduledOf(resource.id).map(({ id, startsAt }) => ({ id, startsAt }))
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    list_resources: listResources,
    create_resource: createResource,
    update_resource: updateResource,
    set_resource_active: setResourceActive,
    list_future_appointments_of_resource: listFutureAppointmentsOfResource,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
