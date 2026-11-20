import { describe, expect, it } from 'vitest'
import { commands } from './bindings'

describe('contrato entre bindings generados y model', () => {
  it('commands expone exactamente los 16 comandos de la aplicación', () => {
    expect(Object.keys(commands).sort()).toEqual([
      'createRole',
      'createUser',
      'currentSession',
      'listAudit',
      'listRoles',
      'listUsers',
      'login',
      'logout',
      'recordActivity',
      'recoverPassword',
      'resetUserPassword',
      'setRolePermissions',
      'setupOwner',
      'setupStatus',
      'unlock',
      'updateUser',
    ])
  })
})
