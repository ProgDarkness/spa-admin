import { describe, expect, it } from 'vitest'
import { commands } from './bindings'

describe('contrato entre bindings generados y model', () => {
  it('commands expone exactamente los 24 comandos de la aplicación', () => {
    expect(Object.keys(commands).sort()).toEqual([
      'createResource',
      'createRole',
      'createService',
      'createUser',
      'currentSession',
      'listAudit',
      'listResources',
      'listRoles',
      'listServices',
      'listUsers',
      'login',
      'logout',
      'recordActivity',
      'recoverPassword',
      'resetUserPassword',
      'setResourceActive',
      'setRolePermissions',
      'setServiceActive',
      'setupOwner',
      'setupStatus',
      'unlock',
      'updateResource',
      'updateService',
      'updateUser',
    ])
  })
})
