import { describe, expect, it } from 'vitest'
import { commands } from './bindings'

describe('contrato entre bindings generados y model', () => {
  it('commands expone exactamente los 31 comandos de la aplicación', () => {
    expect(Object.keys(commands).sort()).toEqual([
      'createPaymentMethod',
      'createResource',
      'createRole',
      'createService',
      'createUser',
      'currentSession',
      'getRate',
      'listAudit',
      'listPaymentMethods',
      'listRates',
      'listResources',
      'listRoles',
      'listServices',
      'listUsers',
      'login',
      'logout',
      'recordActivity',
      'recoverPassword',
      'resetUserPassword',
      'setPaymentMethodActive',
      'setResourceActive',
      'setRolePermissions',
      'setServiceActive',
      'setupOwner',
      'setupStatus',
      'unlock',
      'updatePaymentMethod',
      'updateResource',
      'updateService',
      'updateUser',
      'upsertRate',
    ])
  })
})
