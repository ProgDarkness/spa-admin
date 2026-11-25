import type { ClientInput, ClientSummary } from '@/lib/bindings'
import { toLocalDateTime } from '@/lib/datetime'
import type { Client, SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import type { SharedRows } from './shared-rows'
import { normalizeNationalId } from '@/features/clients/national-id'
import { searchKeyOf, searchTermOf, validPhone } from './clients-rules'
import { clientDeletedReactivateError, nationalIdTakenError, notFoundError, validationError } from './ipc-errors'
import {
  booleanField,
  isRecord,
  nextRecordId,
  normalizedRecordName,
  payloadOf,
  replaceRecord,
  requirePermission,
  type Fields,
} from './record-backend-support'

export type ClientsBackendOptions = {
  session: () => SessionUser | null
  clients: readonly Client[]
  shared?: SharedRows<ClientSummary>
  now?: () => number
}

const CLIENTS_READ = 'clients.read'
const CLIENTS_WRITE = 'clients.write'

function asSummary(client: Client): ClientSummary {
  return {
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    nationalId: client.nationalId,
    phone: client.phone,
    deletedAt: client.deletedAt,
  }
}

function validatedInput(fields: Fields): ClientInput {
  const firstName = normalizedRecordName(fields.firstName)
  if (firstName === null) throw validationError('firstName')
  const lastName = normalizedRecordName(fields.lastName)
  if (lastName === null) throw validationError('lastName')
  const nationalId = typeof fields.nationalId === 'string' ? normalizeNationalId(fields.nationalId) : null
  if (nationalId === null) throw validationError('nationalId')
  const phone = typeof fields.phone === 'string' ? validPhone(fields.phone) : null
  if (phone === null) throw validationError('phone')
  return { firstName, lastName, nationalId, phone }
}

function byId(first: ClientSummary, second: ClientSummary): number {
  return first.id - second.id
}

function hasSameFields(client: ClientSummary, candidate: ClientInput): boolean {
  return (
    client.firstName === candidate.firstName &&
    client.lastName === candidate.lastName &&
    client.nationalId === candidate.nationalId &&
    client.phone === candidate.phone
  )
}

export function createClientsIpcBackend(next: IpcBackend, options: ClientsBackendOptions): IpcBackend {
  const now = options.now ?? (() => Date.now())
  let rows: readonly ClientSummary[] = options.clients.map(asSummary).toSorted(byId)
  options.shared?.write(rows)

  function setRows(updated: readonly ClientSummary[]): void {
    rows = updated
    options.shared?.write(updated)
  }

  function requireClient(id: unknown): ClientSummary {
    if (!Number.isInteger(id)) throw validationError('id')
    const found = rows.find((row) => row.id === id)
    if (!found) throw notFoundError()
    return found
  }

  function ensureNationalIdAvailableForNew(nationalId: string): void {
    const holder = rows.find((row) => row.nationalId === nationalId)
    if (!holder) return
    throw holder.deletedAt === null ? nationalIdTakenError() : clientDeletedReactivateError(holder.id)
  }

  function ensureNationalIdFreeOfOthers(nationalId: string, ownId: number): void {
    if (rows.some((row) => row.id !== ownId && row.nationalId === nationalId)) throw nationalIdTakenError()
  }

  function requireRead(): void {
    requirePermission(options.session, CLIENTS_READ, CLIENTS_WRITE)
  }

  function listClients(args: unknown): ClientSummary[] {
    requireRead()
    const filter = payloadOf(args, 'filter')
    const term = searchTermOf(typeof filter.query === 'string' ? filter.query : '')
    return rows
      .filter((row) => (filter.includeDeleted === true || row.deletedAt === null) && searchKeyOf(row).includes(term))
      .toSorted(byId)
  }

  function getClient(args: unknown): ClientSummary {
    requireRead()
    const id = isRecord(args) ? args.id : undefined
    return requireClient(id)
  }

  function createClient(args: unknown): ClientSummary {
    requirePermission(options.session, CLIENTS_WRITE)
    const input = validatedInput(payloadOf(args, 'input'))
    ensureNationalIdAvailableForNew(input.nationalId)
    const created: ClientSummary = { id: nextRecordId(rows), ...input, deletedAt: null }
    setRows([...rows, created])
    return created
  }

  function updateClient(args: unknown): ClientSummary {
    requirePermission(options.session, CLIENTS_WRITE)
    const fields = payloadOf(args, 'update')
    const before = requireClient(fields.id)
    const input = validatedInput(fields)
    ensureNationalIdFreeOfOthers(input.nationalId, before.id)
    if (hasSameFields(before, input)) return before
    const after: ClientSummary = { ...before, ...input }
    setRows(replaceRecord(rows, after))
    return after
  }

  function setClientDeleted(args: unknown): ClientSummary {
    requirePermission(options.session, CLIENTS_WRITE)
    const fields = payloadOf(args, 'deletion')
    const deleted = booleanField(fields, 'deleted')
    const before = requireClient(fields.id)
    if ((before.deletedAt !== null) === deleted) return before
    const after: ClientSummary = { ...before, deletedAt: deleted ? toLocalDateTime(new Date(now())) : null }
    setRows(replaceRecord(rows, after))
    return after
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    list_clients: listClients,
    get_client: getClient,
    create_client: createClient,
    update_client: updateClient,
    set_client_deleted: setClientDeleted,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
