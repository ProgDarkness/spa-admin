import type {
  ResourceActivation,
  ResourceFilter,
  ResourceInput,
  ResourceKind,
  ResourceSummary,
  ResourceUpdate,
} from '@/lib/bindings'
import type { Resource, SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import { validationError } from './ipc-errors'
import {
  booleanField,
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
    const filter = payloadOf(args, 'filter') as ResourceFilter
    return rows.filter((row) => filter.includeInactive || row.active)
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
    rows = [...rows, created]
    return created
  }

  function updateResource(args: unknown): ResourceSummary {
    requirePermission(options.session, RESOURCES_MANAGE)
    const fields = payloadOf(args, 'update') as Partial<ResourceUpdate> & Fields
    const before = requireResource(fields.id)
    const input = validatedInput(fields)
    ensureNameFree(input.name, before.id)
    if (before.name === input.name && before.kind === input.kind) return before
    const after: ResourceSummary = { ...before, ...input, updatedAt: toInstant(now()) }
    rows = replaceRecord(rows, after)
    return after
  }

  function setResourceActive(args: unknown): ResourceSummary {
    requirePermission(options.session, RESOURCES_MANAGE)
    const fields = payloadOf(args, 'activation') as Partial<ResourceActivation> & Fields
    const active = booleanField(fields, 'active')
    const before = requireResource(fields.id)
    if (before.active === active) return before
    const after: ResourceSummary = { ...before, active, updatedAt: toInstant(now()) }
    rows = replaceRecord(rows, after)
    return after
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    list_resources: listResources,
    create_resource: createResource,
    update_resource: updateResource,
    set_resource_active: setResourceActive,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
