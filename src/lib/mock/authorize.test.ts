import { beforeEach, describe, expect, it } from 'vitest'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import { authorize, currentUser } from './authorize'
import { commit, getState, resetStore } from './store'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('currentUser', () => {
  it('es null sin sesión', () => {
    expect(currentUser(getState())).toBeNull()
  })

  it('devuelve el usuario de sesión sin exponer la contraseña', () => {
    signInAs('recepcion')
    const user = currentUser(getState())
    expect(user?.username).toBe('recepcion')
    expect(user?.roleName).toBe('Recepción')
    expect(user).not.toHaveProperty('password')
  })

  it('es null si el id de sesión no corresponde a un usuario', () => {
    commit({ ...getState(), sessionUserId: 999 })
    expect(currentUser(getState())).toBeNull()
  })

  it('devuelve una copia de los permisos', () => {
    signInAs('lectura')
    const user = currentUser(getState())
    const stored = getState().users.find((candidate) => candidate.username === 'lectura')
    expect(user?.permissions).toEqual(stored?.permissions)
    expect(user?.permissions).not.toBe(stored?.permissions)
  })
})

describe('authorize', () => {
  it('sin sesión devuelve unauthenticated', () => {
    const result = authorize(getState(), 'clients.read')
    expect(result.status === 'error' && result.error.code).toBe('unauthenticated')
  })

  it('con permiso devuelve el usuario', () => {
    signInAs('recepcion')
    const result = authorize(getState(), 'clients.write')
    expect(result.status === 'ok' && result.data.username).toBe('recepcion')
  })

  it('lectura recibe forbidden en escritura', () => {
    signInAs('lectura')
    const result = authorize(getState(), 'clients.write')
    expect(result.status === 'error' && result.error.code).toBe('forbidden')
  })

  it('lectura recibe forbidden en métricas', () => {
    signInAs('lectura')
    const result = authorize(getState(), 'metrics.read')
    expect(result.status === 'error' && result.error.code).toBe('forbidden')
  })

  it('anyOf pasa si basta uno de los permisos', () => {
    signInAs('lectura')
    const result = authorize(getState(), { anyOf: ['catalog.write', 'catalog.read'] })
    expect(result.status).toBe('ok')
  })

  it('anyOf falla con forbidden si no hay ninguno', () => {
    signInAs('lectura')
    const result = authorize(getState(), { anyOf: ['catalog.write', 'rates.manage'] })
    expect(result.status === 'error' && result.error.code).toBe('forbidden')
  })

  it('anyOf vacío niega el acceso', () => {
    signInAs('propietaria')
    const result = authorize(getState(), { anyOf: [] })
    expect(result.status === 'error' && result.error.code).toBe('forbidden')
  })

  it('anyOf sin sesión devuelve unauthenticated', () => {
    const result = authorize(getState(), { anyOf: ['clients.read'] })
    expect(result.status === 'error' && result.error.code).toBe('unauthenticated')
  })

  it('propietaria tiene todos los permisos', () => {
    signInAs('propietaria')
    expect(authorize(getState(), 'backup.manage').status).toBe('ok')
    expect(authorize(getState(), 'appointments.reopen').status).toBe('ok')
  })
})
