import { describe, expect, it } from 'vitest'
import { commands } from './bindings'

describe('contrato entre bindings generados y model', () => {
  it('commands expone exactamente los 20 comandos de la aplicación', () => {
    expect(Object.keys(commands).sort()).toEqual([
      'createRole',
      'createService',
      'createUser',
      'currentSession',
      'listAudit',
      'listRoles',
      'listServices',
      'listUsers',
      'login',
      'logout',
      'recordActivity',
      'recoverPassword',
      'resetUserPassword',
      'setRolePermissions',
      'setServiceActive',
      'setupOwner',
      'setupStatus',
      'unlock',
      'updateService',
      'updateUser',
    ])
  })
})
