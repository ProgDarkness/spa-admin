import { describe, expect, it } from 'vitest'
import { commands } from './bindings'

describe('contrato entre bindings generados y model', () => {
  it('commands expone exactamente los 36 comandos de la aplicación', () => {
    expect(Object.keys(commands).sort()).toEqual([
      'createClient',
      'createPaymentMethod',
      'createResource',
      'createRole',
      'createService',
      'createUser',
      'currentSession',
      'getClient',
      'getRate',
      'listAudit',
      'listClients',
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
      'setClientDeleted',
      'setPaymentMethodActive',
      'setResourceActive',
      'setRolePermissions',
      'setServiceActive',
      'setupOwner',
      'setupStatus',
      'unlock',
      'updateClient',
      'updatePaymentMethod',
      'updateResource',
      'updateService',
      'updateUser',
      'upsertRate',
    ])
  })
})
