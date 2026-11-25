import { commands, type ClientSummary } from '@/lib/bindings'
import { callBackend, settle } from '@/lib/ipc'
import { createMirrorSync, visibleRows } from '@/lib/mirror-sync'
import { commit, getState, upsertById } from '@/lib/mock/store'
import type { Client, ClientInput, ClientListFilter, Id, Result } from '@/lib/model'
import { mapOk } from '@/lib/result'
import { trimUnicodeWhitespace } from '@/lib/text'

const mirrorSync = createMirrorSync()

function toClient(summary: ClientSummary): Client {
  return {
    id: summary.id,
    firstName: summary.firstName,
    lastName: summary.lastName,
    nationalId: summary.nationalId,
    phone: summary.phone,
    deletedAt: summary.deletedAt,
  }
}

function replaceClients(clients: readonly Client[]): void {
  commit({ ...getState(), clients })
}

function mirrorClient(client: Client): void {
  const state = getState()
  commit({ ...state, clients: upsertById(state.clients, client) })
}

function callClientBackend(operation: () => Promise<Result<ClientSummary>>): Promise<Result<Client>> {
  return callBackend(async () => mapOk(await operation(), toClient), mirrorSync.reflectMutation(mirrorClient))
}

function visibleClients(clients: readonly Client[], filter: ClientListFilter): Client[] {
  const rows = clients.map((client) => ({ client, active: client.deletedAt === null }))
  return visibleRows(rows, { includeInactive: filter.includeDeleted }).map(({ client }) => client)
}

type ClientsSnapshot = Readonly<{ all: readonly Client[]; matchedIds: readonly Id[] | null }>

function fetchClients(query: string): Promise<Result<Client[]>> {
  return settle(async () =>
    mapOk(await commands.listClients({ query, includeDeleted: true }), (rows) => rows.map(toClient)),
  )
}

async function fetchSnapshot(query: string): Promise<Result<ClientsSnapshot>> {
  const all = await fetchClients('')
  if (all.status === 'error' || query === '') return mapOk(all, (rows) => ({ all: rows, matchedIds: null }))
  const matches = await fetchClients(query)
  return mapOk(matches, (found) => ({ all: all.data, matchedIds: found.map((client) => client.id) }))
}

function rowsOf({ all, matchedIds }: ClientsSnapshot): Client[] {
  if (matchedIds === null) return [...all]
  const byId = new Map(all.map((client) => [client.id, client]))
  return matchedIds.flatMap((id) => byId.get(id) ?? [])
}

export async function listClients(filter: ClientListFilter): Promise<Result<Client[]>> {
  const query = trimUnicodeWhitespace(filter.query ?? '')
  const snapshot = await mirrorSync.list(
    () => fetchSnapshot(query),
    ({ all }) => replaceClients(all),
  )
  return mapOk(snapshot, (data) => visibleClients(rowsOf(data), filter))
}

export function getClient(id: Id): Promise<Result<Client>> {
  return settle(async () => mapOk(await commands.getClient(id), toClient))
}

export function createClient(input: ClientInput): Promise<Result<Client>> {
  return callClientBackend(() => commands.createClient(input))
}

export function updateClient(id: Id, input: ClientInput): Promise<Result<Client>> {
  return callClientBackend(() => commands.updateClient({ id, ...input }))
}

export function softDeleteClient(id: Id): Promise<Result<Client>> {
  return callClientBackend(() => commands.setClientDeleted({ id, deleted: true }))
}

export function reactivateClient(id: Id): Promise<Result<Client>> {
  return callClientBackend(() => commands.setClientDeleted({ id, deleted: false }))
}
