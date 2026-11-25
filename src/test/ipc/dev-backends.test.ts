import { describe, expect, it } from 'vitest'
import { createSeed } from '@/lib/mock/seed'
import type { PermissionKey, SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import { composeBackends, createDevBackends } from './dev-backends'

const SEED = createSeed('2026-11-12')
const ALL_PERMISSIONS: PermissionKey[] = [
  'catalog.read',
  'catalog.write',
  'resources.manage',
  'appointments.read',
  'payments.read',
  'rates.manage',
  'clients.read',
  'clients.write',
]
const LIST_ALL = { filter: { includeInactive: true } }

function userWith(...permissions: PermissionKey[]): SessionUser {
  return { id: 50, username: 'tester', roleName: 'Prueba', permissions }
}

function authReplying(reply: unknown): IpcBackend {
  return (cmd) => ({ cmd, reply })
}

describe('composeBackends', () => {
  it('sin fábricas devuelve el backend base', () => {
    const base = authReplying('base')

    expect(composeBackends(base)).toBe(base)
  })

  it('cada fábrica envuelve a la anterior y la última es la más externa', () => {
    const order: string[] = []
    const tag = (name: string) => (next: IpcBackend): IpcBackend => (cmd, args) => {
      order.push(name)
      return next(cmd, args)
    }
    const base: IpcBackend = () => {
      order.push('base')
      return null
    }

    composeBackends(base, tag('primera'), tag('segunda'))('cualquiera', undefined)

    expect(order).toEqual(['segunda', 'primera', 'base'])
  })

  it('entrega a cada fábrica el backend inmediatamente interior', () => {
    const received: IpcBackend[] = []
    const base = authReplying('base')
    const first = (next: IpcBackend): IpcBackend => {
      received.push(next)
      return () => 'primera'
    }
    const second = (next: IpcBackend): IpcBackend => {
      received.push(next)
      return () => 'segunda'
    }

    composeBackends(base, first, second)

    expect(received[0]).toBe(base)
    expect(received[1]?.('x', undefined)).toBe('primera')
  })
})

describe('createDevBackends', () => {
  function devBackends(session: SessionUser | null = userWith(...ALL_PERMISSIONS)): IpcBackend {
    return createDevBackends({ auth: authReplying('auth'), session: () => session, seed: SEED })
  }

  it('atiende los comandos de catálogo y de recursos con el seed recibido', () => {
    const backend = devBackends()

    expect(backend('list_services', LIST_ALL)).toHaveLength(SEED.services.length)
    expect(backend('list_resources', LIST_ALL)).toHaveLength(SEED.resources.length)
  })

  it('atiende los comandos de métodos de pago con el seed recibido', () => {
    expect(devBackends()('list_payment_methods', LIST_ALL)).toHaveLength(SEED.paymentMethods.length)
  })

  it('atiende los comandos de tasas con el seed recibido', () => {
    expect(devBackends()('list_rates', undefined)).toHaveLength(SEED.rates.length)
  })

  it('atiende los comandos de clientes con el seed recibido, incluido el eliminado', () => {
    const listed = devBackends()('list_clients', { filter: { query: '', includeDeleted: true } })

    expect(listed).toHaveLength(SEED.clients.length)
    expect(devBackends()('list_clients', { filter: { query: '', includeDeleted: false } })).toHaveLength(
      SEED.clients.length - 1,
    )
  })

  it('delega en el backend de autenticación todo lo demás', () => {
    expect(devBackends()('current_session', undefined)).toEqual({ cmd: 'current_session', reply: 'auth' })
  })

  it('consulta la sesión en cada llamada y no al componer', () => {
    let session: SessionUser | null = null
    const backend = createDevBackends({ auth: authReplying('auth'), session: () => session, seed: SEED })

    expect(() => backend('list_resources', LIST_ALL)).toThrow(expect.objectContaining({ code: 'unauthenticated' }))
    session = userWith('resources.manage')
    expect(backend('list_resources', LIST_ALL)).toHaveLength(SEED.resources.length)
  })

  it('aplica a cada backend sus propios permisos', () => {
    const backend = devBackends(userWith('resources.manage'))

    expect(backend('list_resources', LIST_ALL)).toHaveLength(SEED.resources.length)
    expect(() => backend('list_services', LIST_ALL)).toThrow(expect.objectContaining({ code: 'forbidden' }))
  })

  it('usa el seed de recursos y el de servicios por separado', () => {
    const seed = {
      ...SEED,
      services: SEED.services.slice(0, 2),
      resources: SEED.resources.slice(0, 1),
      paymentMethods: SEED.paymentMethods.slice(0, 3),
      rates: SEED.rates.slice(0, 2),
      clients: SEED.clients.slice(0, 4),
    }
    const backend = createDevBackends({ auth: authReplying('auth'), session: () => userWith(...ALL_PERMISSIONS), seed })

    expect(backend('list_services', LIST_ALL)).toHaveLength(2)
    expect(backend('list_resources', LIST_ALL)).toHaveLength(1)
    expect(backend('list_payment_methods', LIST_ALL)).toHaveLength(3)
    expect(backend('list_rates', undefined)).toHaveLength(2)
    expect(backend('list_clients', { filter: { query: '', includeDeleted: true } })).toHaveLength(4)
  })

  it('el estado es propio de cada composición', () => {
    const first = devBackends()
    const second = devBackends()

    first('create_resource', { input: { name: 'Sala nueva', kind: 'cabin' } })
    first('create_service', { input: { name: 'Servicio nuevo', priceCents: 100, durationMin: 5 } })
    first('create_payment_method', { input: { name: 'Cripto' } })
    first('upsert_rate', { date: '2030-01-01', rateBsPerUsdE4: 1 })
    first('create_client', {
      input: { firstName: 'Nueva', lastName: 'Persona', nationalId: 'V-30111222', phone: '0414-5550000' },
    })

    expect(second('list_resources', LIST_ALL)).toHaveLength(SEED.resources.length)
    expect(second('list_services', LIST_ALL)).toHaveLength(SEED.services.length)
    expect(second('list_payment_methods', LIST_ALL)).toHaveLength(SEED.paymentMethods.length)
    expect(second('list_rates', undefined)).toHaveLength(SEED.rates.length)
    expect(second('list_clients', { filter: { query: '', includeDeleted: true } })).toHaveLength(SEED.clients.length)
    expect(first('list_clients', { filter: { query: '', includeDeleted: true } })).toHaveLength(SEED.clients.length + 1)
    expect(first('list_rates', undefined)).toHaveLength(SEED.rates.length + 1)
    expect(first('list_resources', LIST_ALL)).toHaveLength(SEED.resources.length + 1)
    expect(first('list_payment_methods', LIST_ALL)).toHaveLength(SEED.paymentMethods.length + 1)
  })
})
