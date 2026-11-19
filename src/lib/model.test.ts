import { describe, expect, it } from 'vitest'
import { PERMISSION_KEYS } from './model'
import { createSeed } from './mock/seed'

describe('PERMISSION_KEYS', () => {
  it('contiene exactamente las 15 claves del plan sin duplicados', () => {
    expect(PERMISSION_KEYS).toHaveLength(15)
    expect(new Set(PERMISSION_KEYS).size).toBe(15)
  })

  it('usa el formato recurso.accion', () => {
    for (const key of PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+\.[a-z]+$/)
    }
  })

  it('incluye las claves que gobiernan métricas y reapertura', () => {
    expect(PERMISSION_KEYS).toContain('metrics.read')
    expect(PERMISSION_KEYS).toContain('appointments.reopen')
  })

  it('el seed referencia solo permisos válidos', () => {
    const referencedKeys = createSeed('2026-11-12').users.flatMap((user) => user.permissions)
    for (const key of referencedKeys) {
      expect(PERMISSION_KEYS).toContain(key)
    }
  })
})
