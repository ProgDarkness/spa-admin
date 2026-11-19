import { authorize } from '@/lib/mock/authorize'
import { appendRow, commit, findById, getState, nextId, replaceById } from '@/lib/mock/store'
import type { Client, ClientInput, ClientListFilter, Id, PermissionKey, Result } from '@/lib/model'
import { nowLocal } from '@/lib/datetime'
import { err, ok, validationError } from '@/lib/result'
import { clientInputSchema } from './schemas'
import { matchesClientQuery, normalizeSearchText } from './search'

const CLIENT_NOT_FOUND_MESSAGE = 'Cliente no encontrado'
const NATIONAL_ID_TAKEN_MESSAGE = 'Ya existe un cliente con esa cédula'
const CLIENT_DELETED_MESSAGE = 'Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo?'

function clientNotFound(): Result<never> {
  return err('notFound', CLIENT_NOT_FOUND_MESSAGE)
}

function guard(permission: PermissionKey): Result<null> {
  const access = authorize(getState(), permission)
  return access.status === 'ok' ? ok(null) : access
}

function parseInput(input: unknown): Result<ClientInput> {
  const parsed = clientInputSchema.safeParse(input)
  return parsed.success ? ok(parsed.data) : validationError(parsed.error.issues)
}

function nationalIdConflict(nationalId: string, ownId: Id | null): Result<never> | null {
  const holder = getState().clients.find((client) => client.nationalId === nationalId && client.id !== ownId)
  if (!holder) return null
  if (ownId === null && holder.deletedAt !== null) {
    return err('clientDeletedReactivate', CLIENT_DELETED_MESSAGE, { field: 'nationalId', entityIds: [holder.id] })
  }
  return err('nationalIdTaken', NATIONAL_ID_TAKEN_MESSAGE, { field: 'nationalId' })
}

function storeClient(updated: Client): Client {
  const state = getState()
  commit({ ...state, clients: replaceById(state.clients, updated) })
  return updated
}

export async function listClients(filter: ClientListFilter): Promise<Result<Client[]>> {
  const access = guard('clients.read')
  if (access.status === 'error') return access
  const normalizedQuery = normalizeSearchText((filter.query ?? '').trim())
  const visible = getState().clients.filter((client) => filter.includeDeleted || client.deletedAt === null)
  return ok(visible.filter((client) => matchesClientQuery(client, normalizedQuery)))
}

export async function getClient(id: Id): Promise<Result<Client>> {
  const access = guard('clients.read')
  if (access.status === 'error') return access
  const client = findById(getState().clients, id)
  return client ? ok(client) : clientNotFound()
}

export async function createClient(input: ClientInput): Promise<Result<Client>> {
  const access = guard('clients.write')
  if (access.status === 'error') return access
  const parsed = parseInput(input)
  if (parsed.status === 'error') return parsed
  const conflict = nationalIdConflict(parsed.data.nationalId, null)
  if (conflict) return conflict
  const state = getState()
  const created: Client = { ...parsed.data, id: nextId(state.clients), deletedAt: null }
  commit({ ...state, clients: appendRow(state.clients, created) })
  return ok(created)
}

export async function updateClient(id: Id, input: ClientInput): Promise<Result<Client>> {
  const access = guard('clients.write')
  if (access.status === 'error') return access
  const parsed = parseInput(input)
  if (parsed.status === 'error') return parsed
  const existing = findById(getState().clients, id)
  if (!existing) return clientNotFound()
  const conflict = nationalIdConflict(parsed.data.nationalId, id)
  if (conflict) return conflict
  return ok(storeClient({ ...existing, ...parsed.data }))
}

async function changeDeletion(id: Id, deletedAt: Client['deletedAt']): Promise<Result<Client>> {
  const access = guard('clients.write')
  if (access.status === 'error') return access
  const existing = findById(getState().clients, id)
  if (!existing) return clientNotFound()
  const isAlreadyInTargetState = (existing.deletedAt === null) === (deletedAt === null)
  if (isAlreadyInTargetState) return ok(existing)
  return ok(storeClient({ ...existing, deletedAt }))
}

export async function softDeleteClient(id: Id): Promise<Result<Client>> {
  return changeDeletion(id, nowLocal())
}

export async function reactivateClient(id: Id): Promise<Result<Client>> {
  return changeDeletion(id, null)
}
