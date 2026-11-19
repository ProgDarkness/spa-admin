import { describe, expect, it } from 'vitest'
import { commands } from './bindings'

describe('contrato entre bindings generados y model', () => {
  it('commands expone login, logout y currentSession', () => {
    expect(Object.keys(commands).sort()).toEqual(['currentSession', 'login', 'logout'])
  })
})
