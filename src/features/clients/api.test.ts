import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Client, ClientInput, ClientListFilter, Result } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import {
  createClient,
  getClient,
  listClients,
  reactivateClient,
  softDeleteClient,
  updateClient,
} from './api'

const ACTIVE_FILTER: ClientListFilter = { query: null, includeDeleted: false }
const MARIA_ID = 1
const DELETED_CARLOS_ID = 9
const MISSING_ID = 9999

const NEW_CLIENT: ClientInput = {
  firstName: 'Valentina',
  lastName: 'Ríos',
  nationalId: 'V-30111222',
  phone: '0414-5550000',
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  signInAs('recepcion')
})

function dataOf<T>(result: Result<T>): T {
  if (result.status !== 'ok') throw new Error(`Se esperaba ok, llegó ${result.error.code}`)
  return result.data
}

async function namesMatching(query: string | null): Promise<string[]> {
  const result = await listClients({ query, includeDeleted: false })
  return dataOf(result).map((client) => client.firstName)
}

describe('listClients', () => {
  it('excluye clientes eliminados por defecto', async () => {
    const clients = dataOf(await listClients(ACTIVE_FILTER))

    expect(clients).toHaveLength(8)
    expect(clients.every((client) => client.deletedAt === null)).toBe(true)
  })

  it('incluye eliminados con includeDeleted', async () => {
    const clients = dataOf(await listClients({ query: null, includeDeleted: true }))

    expect(clients).toHaveLength(9)
    expect(clients.some((client) => client.deletedAt !== null)).toBe(true)
  })

  it.each([null, '', '   '])('query %j no filtra', async (query) => {
    expect(await namesMatching(query)).toHaveLength(8)
  })

  it('busca por nombre sin distinguir mayúsculas ni acentos', async () => {
    expect(await namesMatching('maria')).toEqual(['María'])
    expect(await namesMatching('JOSE')).toEqual(['José'])
    expect(await namesMatching('sofía')).toEqual(['Sofía'])
  })

  it('busca por apellido sin distinguir mayúsculas ni acentos', async () => {
    expect(await namesMatching('gonzalez')).toEqual(['María'])
    expect(await namesMatching('HERNANDEZ')).toEqual(['Carla'])
    expect(await namesMatching('díaz')).toEqual(['Pedro'])
  })

  it('busca por cédula completa o parcial, con o sin mayúsculas', async () => {
    expect(await namesMatching('V-12345678')).toEqual(['María'])
    expect(await namesMatching('v-1234')).toEqual(['María'])
    expect(await namesMatching('e-8123')).toEqual(['Gabriela'])
  })

  it('busca por teléfono', async () => {
    expect(await namesMatching('0414-1234567')).toEqual(['María'])
    expect(await namesMatching('0424-23')).toEqual(['José'])
  })

  it('recorta la consulta antes de comparar', async () => {
    expect(await namesMatching('  maria  ')).toEqual(['María'])
  })

  it('devuelve vacío cuando nada coincide', async () => {
    expect(await namesMatching('zzzz')).toEqual([])
  })

  it('combina búsqueda con includeDeleted', async () => {
    const hidden = dataOf(await listClients({ query: 'mendoza', includeDeleted: false }))
    const shown = dataOf(await listClients({ query: 'mendoza', includeDeleted: true }))

    expect(hidden).toEqual([])
    expect(shown.map((client) => client.firstName)).toEqual(['Carlos'])
  })

  it('una búsqueda conserva las nueve filas en el espejo', async () => {
    expect(await namesMatching('maria')).toEqual(['María'])

    expect(getState().clients).toHaveLength(9)
  })

  it('refleja en el espejo la colección completa que devuelve Rust', async () => {
    await listClients({ query: null, includeDeleted: false })

    expect(getState().clients).toHaveLength(9)
  })

  it('permite leer al rol de solo lectura', async () => {
    signInAs('lectura')

    expect((await listClients(ACTIVE_FILTER)).status).toBe('ok')
  })

  it('exige sesión', async () => {
    signOut()

    expect(await listClients(ACTIVE_FILTER)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })
})

function signOut(): void {
  commit({ ...getState(), sessionUserId: null })
}

describe('getClient', () => {
  it('devuelve un cliente activo', async () => {
    expect(dataOf(await getClient(MARIA_ID)).firstName).toBe('María')
  })

  it('devuelve también un cliente eliminado', async () => {
    expect(dataOf(await getClient(DELETED_CARLOS_ID)).deletedAt).not.toBeNull()
  })

  it('responde notFound para id inexistente', async () => {
    expect(await getClient(MISSING_ID)).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })

  it('exige sesión', async () => {
    signOut()

    expect(await getClient(MARIA_ID)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })
})

describe('createClient', () => {
  it('crea el cliente con id siguiente y sin eliminación', async () => {
    const created = dataOf(await createClient(NEW_CLIENT))

    expect(created).toEqual({ ...NEW_CLIENT, id: 10, deletedAt: null })
    expect(getState().clients).toContainEqual(created)
  })

  it('guarda los textos recortados', async () => {
    const created = dataOf(await createClient({ ...NEW_CLIENT, firstName: '  Valentina ' }))

    expect(created.firstName).toBe('Valentina')
  })

  it('el cliente creado aparece en la búsqueda por su cédula', async () => {
    await createClient(NEW_CLIENT)

    expect(await namesMatching('V-30111222')).toEqual(['Valentina'])
  })

  it('rechaza cédula activa duplicada con nationalIdTaken en el campo nationalId', async () => {
    const before = getState()

    const result = await createClient({ ...NEW_CLIENT, nationalId: 'V-12345678' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'nationalIdTaken', field: 'nationalId' } })
    expect(getState()).toBe(before)
  })

  it('cédula de cliente eliminado responde clientDeletedReactivate con su id', async () => {
    const deleted = getState().clients.find((client) => client.id === DELETED_CARLOS_ID) as Client

    const result = await createClient({ ...NEW_CLIENT, nationalId: deleted.nationalId })

    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'clientDeletedReactivate', field: 'nationalId', entityIds: [DELETED_CARLOS_ID] },
    })
    expect(getState().clients).toHaveLength(9)
  })

  it.each([
    ['firstName', { firstName: '  ' }],
    ['lastName', { lastName: '' }],
    ['nationalId', { nationalId: 'X-12345678' }],
    ['nationalId', { nationalId: '' }],
    ['phone', { phone: '' }],
    ['phone', { phone: 'abc' }],
  ])('rechaza %s inválido con validation y field', async (field, patch) => {
    const before = getState()

    const result = await createClient({ ...NEW_CLIENT, ...patch })

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field } })
    expect(getState()).toBe(before)
  })

  it('Rust normaliza la cédula escrita en minúsculas o sin guion', async () => {
    const created = dataOf(await createClient({ ...NEW_CLIENT, nationalId: 'v 30.111.222' }))

    expect(created.nationalId).toBe('V-30111222')
  })

  it('prohíbe al rol de solo lectura sin tocar el estado', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await createClient(NEW_CLIENT)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it('exige sesión', async () => {
    signOut()

    expect(await createClient(NEW_CLIENT)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('no reutiliza ni muta las filas previas', async () => {
    const before = getState()
    const previousClients = before.clients

    await createClient(NEW_CLIENT)

    expect(getState().clients).not.toBe(previousClients)
    expect(previousClients).toHaveLength(9)
  })
})

describe('updateClient', () => {
  const EDIT: ClientInput = { firstName: 'Mariela', lastName: 'González', nationalId: 'V-12345678', phone: '0414-0000000' }

  it('actualiza los datos conservando id y deletedAt', async () => {
    const updated = dataOf(await updateClient(MARIA_ID, EDIT))

    expect(updated).toEqual({ ...EDIT, id: MARIA_ID, deletedAt: null })
    expect(dataOf(await getClient(MARIA_ID))).toEqual(updated)
  })

  it('permite conservar la propia cédula', async () => {
    expect((await updateClient(MARIA_ID, EDIT)).status).toBe('ok')
  })

  it('permite cambiar a una cédula libre', async () => {
    const updated = dataOf(await updateClient(MARIA_ID, { ...EDIT, nationalId: 'V-30999888' }))

    expect(updated.nationalId).toBe('V-30999888')
  })

  it('rechaza la cédula de otro cliente con nationalIdTaken', async () => {
    const before = getState()

    const result = await updateClient(MARIA_ID, { ...EDIT, nationalId: 'V-14567890' })

    expect(result).toMatchObject({ status: 'error', error: { code: 'nationalIdTaken', field: 'nationalId' } })
    expect(getState()).toBe(before)
  })

  it('rechaza también la cédula de otro cliente eliminado', async () => {
    const deleted = getState().clients.find((client) => client.id === DELETED_CARLOS_ID) as Client

    const result = await updateClient(MARIA_ID, { ...EDIT, nationalId: deleted.nationalId })

    expect(result).toMatchObject({ status: 'error', error: { code: 'nationalIdTaken' } })
  })

  it('responde notFound para id inexistente', async () => {
    expect(await updateClient(MISSING_ID, EDIT)).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })

  it('rechaza datos inválidos con validation y field', async () => {
    expect(await updateClient(MARIA_ID, { ...EDIT, firstName: ' ' })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'firstName' },
    })
  })

  it('prohíbe al rol de solo lectura', async () => {
    signInAs('lectura')

    expect(await updateClient(MARIA_ID, EDIT)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('exige sesión', async () => {
    signOut()

    expect(await updateClient(MARIA_ID, EDIT)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('reemplaza la fila sin mutar la anterior', async () => {
    const previousRow = getState().clients.find((client) => client.id === MARIA_ID) as Client
    const snapshot = { ...previousRow }

    await updateClient(MARIA_ID, EDIT)

    expect(previousRow).toEqual(snapshot)
    expect(getState().clients.find((client) => client.id === MARIA_ID)).not.toBe(previousRow)
  })
})

describe('softDeleteClient', () => {
  it('marca deletedAt con la hora local actual', async () => {
    const deleted = dataOf(await softDeleteClient(MARIA_ID))

    expect(deleted.deletedAt).toBe('2026-11-12T09:00')
    expect(deleted.firstName).toBe('María')
  })

  it('oculta al cliente de la lista por defecto pero lo conserva', async () => {
    await softDeleteClient(MARIA_ID)

    expect(await namesMatching('maria')).toEqual([])
    const withDeleted = dataOf(await listClients({ query: 'maria', includeDeleted: true }))
    expect(withDeleted.map((client) => [client.firstName, client.deletedAt])).toEqual([['María', '2026-11-12T09:00']])
  })

  it('es idempotente sobre un cliente ya eliminado', async () => {
    const original = dataOf(await getClient(DELETED_CARLOS_ID))

    const result = dataOf(await softDeleteClient(DELETED_CARLOS_ID))

    expect(result).toEqual(original)
    expect(getState().clients.find((client) => client.id === DELETED_CARLOS_ID)).toEqual(original)
  })

  it('responde notFound para id inexistente', async () => {
    expect(await softDeleteClient(MISSING_ID)).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })

  it('prohíbe al rol de solo lectura sin tocar el estado', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await softDeleteClient(MARIA_ID)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it('exige sesión', async () => {
    signOut()

    expect(await softDeleteClient(MARIA_ID)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('no muta la fila anterior', async () => {
    const previousRow = getState().clients.find((client) => client.id === MARIA_ID) as Client

    await softDeleteClient(MARIA_ID)

    expect(previousRow.deletedAt).toBeNull()
  })
})

describe('reactivateClient', () => {
  it('limpia deletedAt y devuelve al cliente a la lista', async () => {
    const reactivated = dataOf(await reactivateClient(DELETED_CARLOS_ID))

    expect(reactivated.deletedAt).toBeNull()
    expect(await namesMatching('mendoza')).toEqual(['Carlos'])
  })

  it('es idempotente sobre un cliente activo', async () => {
    const original = getState().clients.find((client) => client.id === MARIA_ID) as Client

    expect(dataOf(await reactivateClient(MARIA_ID))).toEqual(original)
    expect(getState().clients.find((client) => client.id === MARIA_ID)).toEqual(original)
  })

  it('responde notFound para id inexistente', async () => {
    expect(await reactivateClient(MISSING_ID)).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })

  it('prohíbe al rol de solo lectura', async () => {
    signInAs('lectura')

    expect(await reactivateClient(DELETED_CARLOS_ID)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('exige sesión', async () => {
    signOut()

    expect(await reactivateClient(DELETED_CARLOS_ID)).toMatchObject({
      status: 'error',
      error: { code: 'unauthenticated' },
    })
  })

  it('no muta la fila anterior', async () => {
    const previousRow = getState().clients.find((client) => client.id === DELETED_CARLOS_ID) as Client
    const snapshot = { ...previousRow }

    await reactivateClient(DELETED_CARLOS_ID)

    expect(previousRow).toEqual(snapshot)
  })
})
