import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type ClientInput, type ClientSummary } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { PermissionKey, SessionUser } from '@/lib/model'
import { createClientsIpcBackend } from './clients-backend'

const SEED = createSeed('2026-11-12')
const SEED_CLIENT_COUNT = 9
const DELETED_SEED_ID = 9
const MARIA_ID = 1
const NOW_MS = new Date(2026, 10, 12, 13, 45, 30).getTime()
const NOW_LOCAL_MINUTE = '2026-11-12T13:45'

const validInput: ClientInput = {
  firstName: 'Valentina',
  lastName: 'Ríos',
  nationalId: 'V-30111222',
  phone: '0414-5550000',
}

let session: SessionUser | null

function userWith(...permissions: PermissionKey[]): SessionUser {
  return { id: 50, username: 'tester', roleName: 'Prueba', permissions }
}

function failWhenUnrouted(command: string): never {
  throw new Error(`IPC no simulado: ${command}`)
}

beforeEach(() => {
  session = userWith('clients.read', 'clients.write')
  mockIPC(
    createClientsIpcBackend(failWhenUnrouted, {
      session: () => session,
      clients: SEED.clients,
      now: () => NOW_MS,
    }),
  )
})

afterEach(() => clearMocks())

function dataOf<T>(outcome: { status: 'ok'; data: T } | { status: 'error'; error: unknown }): T {
  if (outcome.status !== 'ok') throw new Error(`se esperaba ok: ${JSON.stringify(outcome.error)}`)
  return outcome.data
}

async function namesMatching(query: string, includeDeleted = false): Promise<string[]> {
  const listed = dataOf(await commands.listClients({ query, includeDeleted }))
  return listed.map((client) => client.firstName)
}

describe('autorización', () => {
  it('rechaza todos los comandos sin sesión con unauthenticated', async () => {
    session = null

    const outcomes = [
      await commands.listClients({ query: '', includeDeleted: true }),
      await commands.getClient(MARIA_ID),
      await commands.createClient(validInput),
      await commands.updateClient({ id: MARIA_ID, ...validInput }),
      await commands.setClientDeleted({ id: MARIA_ID, deleted: true }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } }))
  })

  it('permite leer con solo clients.read y con solo clients.write', async () => {
    session = userWith('clients.read')
    expect(await commands.listClients({ query: '', includeDeleted: true })).toMatchObject({ status: 'ok' })
    expect(await commands.getClient(MARIA_ID)).toMatchObject({ status: 'ok' })
    session = userWith('clients.write')
    expect(await commands.listClients({ query: '', includeDeleted: true })).toMatchObject({ status: 'ok' })
    expect(await commands.getClient(MARIA_ID)).toMatchObject({ status: 'ok' })
  })

  it('rechaza leer sin ninguno de los dos permisos con forbidden', async () => {
    session = userWith('catalog.read')

    expect(await commands.listClients({ query: '', includeDeleted: true })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
    expect(await commands.getClient(MARIA_ID)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('escribir exige clients.write y no cambia nada con solo clients.read', async () => {
    session = userWith('clients.read')

    const outcomes = [
      await commands.createClient(validInput),
      await commands.updateClient({ id: MARIA_ID, ...validInput, nationalId: 'V-12345678' }),
      await commands.setClientDeleted({ id: MARIA_ID, deleted: true }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'forbidden' } }))
    session = userWith('clients.read', 'clients.write')
    expect(dataOf(await commands.listClients({ query: '', includeDeleted: true }))).toHaveLength(SEED_CLIENT_COUNT)
  })
})

describe('listClients', () => {
  it('devuelve los nueve clientes del seed ordenados por id, el último eliminado', async () => {
    const listed = dataOf(await commands.listClients({ query: '', includeDeleted: true }))

    expect(listed.map((client) => client.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(listed.filter((client) => client.deletedAt !== null).map((client) => client.id)).toEqual([DELETED_SEED_ID])
  })

  it('excluye eliminados salvo con includeDeleted', async () => {
    expect(dataOf(await commands.listClients({ query: '', includeDeleted: false }))).toHaveLength(SEED_CLIENT_COUNT - 1)
    expect(dataOf(await commands.listClients({ query: '', includeDeleted: true }))).toHaveLength(SEED_CLIENT_COUNT)
  })

  it('cada fila tiene exactamente las claves de ClientSummary', async () => {
    const listed = dataOf(await commands.listClients({ query: '', includeDeleted: true }))

    listed.forEach((client) =>
      expect(Object.keys(client).sort()).toEqual(['deletedAt', 'firstName', 'id', 'lastName', 'nationalId', 'phone']),
    )
  })

  it('busca por nombre sin distinguir mayúsculas ni tildes', async () => {
    expect(await namesMatching('maria')).toEqual(['María'])
    expect(await namesMatching('JOSE')).toEqual(['José'])
    expect(await namesMatching('sofía')).toEqual(['Sofía'])
  })

  it('busca por apellido sin distinguir mayúsculas ni tildes', async () => {
    expect(await namesMatching('gonzalez')).toEqual(['María'])
    expect(await namesMatching('HERNANDEZ')).toEqual(['Carla'])
  })

  it('busca por nombre y apellido juntos', async () => {
    expect(await namesMatching('maria gonzalez')).toEqual(['María'])
  })

  it.each(['V-12345678', 'v-1234', 'V12345678', 'v 12345678', 'V-12.345.678'])(
    'busca por cédula con la forma %j',
    async (query) => {
      expect(await namesMatching(query)).toEqual(['María'])
    },
  )

  it('busca la cédula E por su prefijo', async () => {
    expect(await namesMatching('e-8123')).toEqual(['Gabriela'])
  })

  it.each(['0414-1234567', '04141234567', '0414 1234567', '0414-123'])('busca por teléfono con la forma %j', async (query) => {
    expect(await namesMatching(query)).toEqual(['María'])
  })

  it('recorta la consulta antes de comparar', async () => {
    expect(await namesMatching('  maria  ')).toEqual(['María'])
  })

  it('devuelve vacío cuando nada coincide y todo con consulta en blanco', async () => {
    expect(await namesMatching('zzzz')).toEqual([])
    expect(await namesMatching('   ')).toHaveLength(SEED_CLIENT_COUNT - 1)
  })

  it('devuelve las filas ordenadas por id aunque el seed llegue desordenado', async () => {
    const scrambled = [SEED.clients[2], SEED.clients[0], SEED.clients[1]].flatMap((client) => (client ? [client] : []))
    mockIPC(createClientsIpcBackend(failWhenUnrouted, { session: () => session, clients: scrambled }))

    const listed = dataOf(await commands.listClients({ query: '', includeDeleted: true }))
    await commands.createClient(validInput)
    const afterCreate = dataOf(await commands.listClients({ query: '', includeDeleted: true }))

    expect(listed.map((client) => client.id)).toEqual([1, 2, 3])
    expect(afterCreate.map((client) => client.id)).toEqual([1, 2, 3, 4])
  })

  it('una consulta con forma de cédula con puntos de miles busca por la cédula compacta y por los dígitos del teléfono', async () => {
    expect(await namesMatching('12.345.678')).toEqual(['María', 'Ana'])
  })

  it('trata % y _ como texto literal', async () => {
    expect(await namesMatching('%')).toEqual([])
    expect(await namesMatching('_')).toEqual([])
  })

  it('combina búsqueda con includeDeleted', async () => {
    expect(await namesMatching('mendoza', false)).toEqual([])
    expect(await namesMatching('mendoza', true)).toEqual(['Carlos'])
  })

  it('una consulta enorme corre sobre sus primeros cien caracteres', async () => {
    expect(await namesMatching(`maria${' '.repeat(500)}`)).toEqual(['María'])
    expect(await namesMatching(`${'a'.repeat(101)}`)).toEqual([])
  })
})

describe('getClient', () => {
  it('devuelve activos y eliminados', async () => {
    expect(dataOf(await commands.getClient(MARIA_ID))).toMatchObject({ firstName: 'María', deletedAt: null })
    expect(dataOf(await commands.getClient(DELETED_SEED_ID)).deletedAt).not.toBeNull()
  })

  it.each(['1', null, 1.5, undefined])('un id no entero %j es validation en id y no notFound', async (id) => {
    expect(await commands.getClient(id as unknown as number)).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'id' },
    })
  })

  it('responde notFound para un id inexistente', async () => {
    expect(await commands.getClient(999)).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })
})

describe('createClient', () => {
  it('asigna el id siguiente, no elimina y deja el cliente buscable', async () => {
    const created = dataOf(await commands.createClient(validInput))

    expect(created).toEqual({ ...validInput, id: SEED_CLIENT_COUNT + 1, deletedAt: null })
    expect(await namesMatching('V-30111222')).toEqual(['Valentina'])
  })

  it('normaliza nombre, cédula y teléfono como Rust', async () => {
    const created = dataOf(
      await commands.createClient({
        firstName: '  Vale   Ana ',
        lastName: ' Ríos ',
        nationalId: ' v 30.111.222 ',
        phone: '  0414   5550000 ',
      }),
    )

    expect(created).toMatchObject({
      firstName: 'Vale Ana',
      lastName: 'Ríos',
      nationalId: 'V-30111222',
      phone: '0414 5550000',
    })
  })

  it.each([
    ['firstName', { firstName: '  ' }],
    ['firstName', { firstName: 'a'.repeat(81) }],
    ['lastName', { lastName: '' }],
    ['nationalId', { nationalId: 'X-12345678' }],
    ['nationalId', { nationalId: '' }],
    ['phone', { phone: '' }],
    ['phone', { phone: 'abc' }],
  ])('rechaza %s inválido con validation y el campo', async (field, patch) => {
    expect(await commands.createClient({ ...validInput, ...patch })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field, entityIds: null },
    })
    expect(dataOf(await commands.listClients({ query: '', includeDeleted: true }))).toHaveLength(SEED_CLIENT_COUNT)
  })

  it('valida los campos en el orden de Rust: nombre, apellido, cédula, teléfono', async () => {
    const outcome = await commands.createClient({ firstName: '', lastName: '', nationalId: '', phone: '' })

    expect(outcome).toMatchObject({ status: 'error', error: { field: 'firstName' } })
  })

  it('acepta puntos de miles en la cédula y rechaza un BOM como espacio', async () => {
    const created = dataOf(await commands.createClient({ ...validInput, nationalId: 'V-30.111.222' }))

    expect(created.nationalId).toBe('V-30111222')
    expect(await commands.createClient({ ...validInput, nationalId: '\uFEFFV-30111223' })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'nationalId' },
    })
  })

  it('rechaza una cédula activa repetida con nationalIdTaken', async () => {
    expect(await commands.createClient({ ...validInput, nationalId: 'v-12.345.678' })).toMatchObject({
      status: 'error',
      error: { code: 'nationalIdTaken', field: 'nationalId', entityIds: null },
    })
  })

  it('guía la reactivación cuando la cédula es de un cliente eliminado', async () => {
    const deleted = dataOf(await commands.getClient(DELETED_SEED_ID))

    expect(await commands.createClient({ ...validInput, nationalId: deleted.nationalId })).toMatchObject({
      status: 'error',
      error: { code: 'clientDeletedReactivate', field: 'nationalId', entityIds: [DELETED_SEED_ID] },
    })
    expect(dataOf(await commands.listClients({ query: '', includeDeleted: true }))).toHaveLength(SEED_CLIENT_COUNT)
  })

  it('una cédula equivalente tras normalizar también colisiona', async () => {
    const outcome = await commands.createClient({ ...validInput, nationalId: 'V 12345678' })

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'nationalIdTaken' } })
  })
})

describe('updateClient', () => {
  const edit = { id: MARIA_ID, firstName: 'Mariela', lastName: 'González', nationalId: 'V-12345678', phone: '0414-0000000' }

  it('actualiza conservando id y deletedAt y reindexa la búsqueda', async () => {
    const updated = dataOf(await commands.updateClient(edit))

    expect(updated).toEqual({ ...edit, deletedAt: null })
    expect(await namesMatching('mariela')).toEqual(['Mariela'])
    expect(await namesMatching('0414-1234567')).toEqual([])
  })

  it('permite editar un cliente eliminado y lo mantiene eliminado', async () => {
    const deleted = dataOf(await commands.getClient(DELETED_SEED_ID))

    const updated = dataOf(
      await commands.updateClient({
        id: DELETED_SEED_ID,
        firstName: 'Carlitos',
        lastName: deleted.lastName,
        nationalId: deleted.nationalId,
        phone: deleted.phone,
      }),
    )

    expect(updated).toMatchObject({ firstName: 'Carlitos', deletedAt: deleted.deletedAt })
  })

  it('es no-op sin cambios: devuelve la fila tal cual', async () => {
    const before = dataOf(await commands.getClient(MARIA_ID))

    const result = dataOf(
      await commands.updateClient({
        id: MARIA_ID,
        firstName: ' María ',
        lastName: before.lastName,
        nationalId: 'v-12345678',
        phone: before.phone,
      }),
    )

    expect(result).toEqual(before)
  })

  it('rechaza la cédula de otro cliente, incluso eliminado, con nationalIdTaken', async () => {
    const deleted = dataOf(await commands.getClient(DELETED_SEED_ID))

    expect(await commands.updateClient({ ...edit, nationalId: 'V-14567890' })).toMatchObject({
      status: 'error',
      error: { code: 'nationalIdTaken' },
    })
    expect(await commands.updateClient({ ...edit, nationalId: deleted.nationalId })).toMatchObject({
      status: 'error',
      error: { code: 'nationalIdTaken' },
    })
  })

  it('responde notFound antes de validar si el id no existe', async () => {
    expect(await commands.updateClient({ ...edit, id: 999, firstName: '' })).toMatchObject({
      status: 'error',
      error: { code: 'notFound' },
    })
  })

  it('rechaza datos inválidos con validation y el campo', async () => {
    expect(await commands.updateClient({ ...edit, phone: 'abc' })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'phone' },
    })
  })
})

describe('setClientDeleted', () => {
  it('marca deletedAt con el minuto local actual y oculta al cliente de la lista activa', async () => {
    const deleted = dataOf(await commands.setClientDeleted({ id: MARIA_ID, deleted: true }))

    expect(deleted.deletedAt).toBe(NOW_LOCAL_MINUTE)
    expect(await namesMatching('maria')).toEqual([])
    expect(await namesMatching('maria', true)).toEqual(['María'])
  })

  it('reactiva limpiando deletedAt', async () => {
    const reactivated = dataOf(await commands.setClientDeleted({ id: DELETED_SEED_ID, deleted: false }))

    expect(reactivated.deletedAt).toBeNull()
    expect(await namesMatching('mendoza')).toEqual(['Carlos'])
  })

  it('es no-op si ya está en el estado pedido y conserva el instante original', async () => {
    const original = dataOf(await commands.getClient(DELETED_SEED_ID))

    const again = dataOf(await commands.setClientDeleted({ id: DELETED_SEED_ID, deleted: true }))
    const active = dataOf(await commands.setClientDeleted({ id: MARIA_ID, deleted: false }))

    expect(again).toEqual(original)
    expect(active.deletedAt).toBeNull()
  })

  it('un id no entero es validation en id', async () => {
    expect(await commands.setClientDeleted({ id: '1' as unknown as number, deleted: true })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'id' },
    })
    expect(await commands.updateClient({ id: null as unknown as number, ...validInput })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'id' },
    })
  })

  it('responde notFound para un id inexistente', async () => {
    expect(await commands.setClientDeleted({ id: 999, deleted: true })).toMatchObject({
      status: 'error',
      error: { code: 'notFound' },
    })
  })
})

describe('aislamiento', () => {
  it('delega en el siguiente backend lo que no es de clientes', () => {
    const backend = createClientsIpcBackend((cmd) => `siguiente:${cmd}`, {
      session: () => session,
      clients: SEED.clients,
    })

    expect(backend('list_services', undefined)).toBe('siguiente:list_services')
  })

  it('no muta el arreglo de seed recibido', async () => {
    const snapshot: ClientSummary[] = SEED.clients.map((client) => ({ ...client }))

    await commands.setClientDeleted({ id: MARIA_ID, deleted: true })
    await commands.createClient(validInput)

    expect(SEED.clients).toEqual(snapshot)
  })
})
