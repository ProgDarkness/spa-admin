import { beforeEach, describe, expect, it } from 'vitest'
import { nowLocal } from '@/lib/datetime'
import { getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from './clock'
import { signInAs } from './session'

describe('freezeDate', () => {
  it('congela solo Date en la hora local indicada', () => {
    freezeDate('2026-11-12T09:00')
    expect(nowLocal()).toBe('2026-11-12T09:00')
    expect(new Date().getFullYear()).toBe(2026)
  })

  it('permite congelar otra fecha después', () => {
    freezeDate('2026-01-02T03:04')
    expect(nowLocal()).toBe('2026-01-02T03:04')
  })
})

describe('signInAs', () => {
  beforeEach(() => {
    freezeDate('2026-11-12T09:00')
    resetStore()
  })

  it('fija la sesión en el store y devuelve el usuario de sesión', () => {
    const user = signInAs('recepcion')
    expect(user.username).toBe('recepcion')
    expect(getState().sessionUserId).toBe(user.id)
  })

  it('no altera la referencia previa del estado', () => {
    const before = getState()
    signInAs('lectura')
    expect(before.sessionUserId).toBeNull()
  })

  it('cambia de usuario al invocarse de nuevo', () => {
    signInAs('lectura')
    const user = signInAs('propietaria')
    expect(getState().sessionUserId).toBe(user.id)
  })
})
