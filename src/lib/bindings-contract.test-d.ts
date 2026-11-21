import { describe, expectTypeOf, it } from 'vitest'
import { commands } from './bindings'
import type {
  ClockRollback as BindingsClockRollback,
  ExchangeRate as BindingsExchangeRate,
  OwnerSetup as BindingsOwnerSetup,
  OwnerSetupResult as BindingsOwnerSetupResult,
  SetupStatus as BindingsSetupStatus,
} from './bindings'
import type {
  AuditAction as BindingsAuditAction,
  AuditEntity as BindingsAuditEntity,
  AuditEntry as BindingsAuditEntry,
  AuditPage as BindingsAuditPage,
  AuditQuery as BindingsAuditQuery,
  NewRole as BindingsNewRole,
  NewUserInput as BindingsNewUserInput,
  PasswordReset as BindingsPasswordReset,
  PaymentMethodActivation as BindingsPaymentMethodActivation,
  PaymentMethodFilter as BindingsPaymentMethodFilter,
  PaymentMethodInput as BindingsPaymentMethodInput,
  PaymentMethodSummary as BindingsPaymentMethodSummary,
  PaymentMethodUpdate as BindingsPaymentMethodUpdate,
  RecoveryRequest as BindingsRecoveryRequest,
  RecoveryResult as BindingsRecoveryResult,
  ResourceActivation as BindingsResourceActivation,
  ResourceFilter as BindingsResourceFilter,
  ResourceInput as BindingsResourceInput,
  ResourceKind as BindingsResourceKind,
  ResourceSummary as BindingsResourceSummary,
  ResourceUpdate as BindingsResourceUpdate,
  RolePermissionsUpdate as BindingsRolePermissionsUpdate,
  RoleSummary as BindingsRoleSummary,
  ServiceActivation as BindingsServiceActivation,
  ServiceFilter as BindingsServiceFilter,
  ServiceInput as BindingsServiceInput,
  ServiceSummary as BindingsServiceSummary,
  ServiceUpdate as BindingsServiceUpdate,
  UserSummary as BindingsUserSummary,
  UserUpdate as BindingsUserUpdate,
} from './bindings'
import type { AppError as BindingsAppError, AppErrorCode as BindingsAppErrorCode } from './bindings'
import type { PermissionKey as BindingsPermissionKey, SessionUser as BindingsSessionUser } from './bindings'
import type { SessionStatus as BindingsSessionStatus, SessionView as BindingsSessionView } from './bindings'
import type {
  AppError,
  AppErrorCode,
  PermissionKey,
  Resource,
  ResourceInput,
  ResourceKind,
  ResourceListFilter,
  Service,
  ServiceInput,
  ServiceListFilter,
  SessionUser,
  SessionView,
  SessionViewStatus,
} from './model'

describe('contrato de tipos entre bindings generados y model', () => {
  it('SessionUser es equivalente en ambos sentidos', () => {
    expectTypeOf<BindingsSessionUser>().toEqualTypeOf<SessionUser>()
    expectTypeOf<SessionUser>().toExtend<BindingsSessionUser>()
    expectTypeOf<BindingsSessionUser>().toExtend<SessionUser>()
  })

  it('SessionView y su estado son equivalentes en ambos sentidos', () => {
    expectTypeOf<BindingsSessionView>().toEqualTypeOf<SessionView>()
    expectTypeOf<BindingsSessionStatus>().toEqualTypeOf<SessionViewStatus>()
  })

  it('sessionLocked pertenece a ambos AppErrorCode', () => {
    expectTypeOf<'sessionLocked'>().toExtend<BindingsAppErrorCode>()
    expectTypeOf<'sessionLocked'>().toExtend<AppErrorCode>()
  })

  it('setupStatus y setupOwner exponen los tipos de primer arranque', () => {
    expectTypeOf<BindingsSetupStatus['needsOwner']>().toEqualTypeOf<boolean>()
    expectTypeOf<BindingsSetupStatus['clockRollback']>().toEqualTypeOf<BindingsClockRollback | null>()
    expectTypeOf<BindingsClockRollback>().toEqualTypeOf<{ lastRecordedAt: string; detectedAt: string }>()
    expectTypeOf<BindingsOwnerSetup>().toEqualTypeOf<{ username: string; password: string }>()
    expectTypeOf<BindingsOwnerSetupResult>().toEqualTypeOf<{ user: BindingsSessionUser; recoveryCode: string }>()
    expectTypeOf(commands.setupOwner).parameter(0).toEqualTypeOf<BindingsOwnerSetup>()
  })

  it('recoverPassword expone RecoveryRequest y RecoveryResult', () => {
    expectTypeOf<BindingsRecoveryRequest>().toEqualTypeOf<{ username: string; recoveryCode: string; newPassword: string }>()
    expectTypeOf<BindingsRecoveryResult>().toEqualTypeOf<{ recoveryCode: string }>()
    expectTypeOf(commands.recoverPassword).parameter(0).toEqualTypeOf<BindingsRecoveryRequest>()
  })

  it('los comandos de usuarios y roles exponen sus tipos', () => {
    expectTypeOf<BindingsUserSummary>().toEqualTypeOf<{
      id: number
      username: string
      roleId: number
      roleName: string
      active: boolean
      createdAt: string
      updatedAt: string
    }>()
    expectTypeOf<BindingsRoleSummary>().toEqualTypeOf<{
      id: number
      name: string
      permissions: BindingsPermissionKey[]
      userCount: number
    }>()
    expectTypeOf<BindingsNewUserInput>().toEqualTypeOf<{ username: string; password: string; roleId: number }>()
    expectTypeOf<BindingsUserUpdate>().toEqualTypeOf<{
      id: number
      username: string | null
      roleId: number | null
      active: boolean | null
    }>()
    expectTypeOf<BindingsPasswordReset>().toEqualTypeOf<{ userId: number; newPassword: string }>()
    expectTypeOf<BindingsNewRole>().toEqualTypeOf<{ name: string; permissions: BindingsPermissionKey[] }>()
    expectTypeOf<BindingsRolePermissionsUpdate>().toEqualTypeOf<{
      roleId: number
      permissions: BindingsPermissionKey[]
    }>()
    expectTypeOf(commands.createUser).parameter(0).toEqualTypeOf<BindingsNewUserInput>()
    expectTypeOf(commands.updateUser).parameter(0).toEqualTypeOf<BindingsUserUpdate>()
    expectTypeOf(commands.resetUserPassword).parameter(0).toEqualTypeOf<BindingsPasswordReset>()
    expectTypeOf(commands.createRole).parameter(0).toEqualTypeOf<BindingsNewRole>()
    expectTypeOf(commands.setRolePermissions).parameter(0).toEqualTypeOf<BindingsRolePermissionsUpdate>()
  })

  it('los comandos de servicios exponen sus tipos', () => {
    expectTypeOf<BindingsServiceSummary>().toEqualTypeOf<{
      id: number
      name: string
      priceCents: number
      currency: string
      durationMin: number
      active: boolean
      createdAt: string
      updatedAt: string
    }>()
    expectTypeOf<BindingsServiceInput>().toEqualTypeOf<{ name: string; priceCents: number; durationMin: number }>()
    expectTypeOf<BindingsServiceUpdate>().toEqualTypeOf<{
      id: number
      name: string
      priceCents: number
      durationMin: number
    }>()
    expectTypeOf<BindingsServiceFilter>().toEqualTypeOf<{ includeInactive: boolean }>()
    expectTypeOf<BindingsServiceActivation>().toEqualTypeOf<{ id: number; active: boolean }>()
    expectTypeOf(commands.listServices).parameter(0).toEqualTypeOf<BindingsServiceFilter>()
    expectTypeOf(commands.createService).parameter(0).toEqualTypeOf<BindingsServiceInput>()
    expectTypeOf(commands.updateService).parameter(0).toEqualTypeOf<BindingsServiceUpdate>()
    expectTypeOf(commands.setServiceActive).parameter(0).toEqualTypeOf<BindingsServiceActivation>()
  })

  it('Service de model se deriva de ServiceSummary conservando la moneda de una sola variante', () => {
    type ExpectedService = {
      id: number
      name: string
      priceCents: number
      currency: 'USD'
      durationMin: number
      active: boolean
    }
    expectTypeOf<Service>().toExtend<ExpectedService>()
    expectTypeOf<ExpectedService>().toExtend<Service>()
    expectTypeOf<Service['id' | 'name' | 'priceCents' | 'durationMin' | 'active']>().toEqualTypeOf<
      BindingsServiceSummary['id' | 'name' | 'priceCents' | 'durationMin' | 'active']
    >()
    expectTypeOf<Service['currency']>().toExtend<BindingsServiceSummary['currency']>()
    expectTypeOf<Service['currency']>().not.toEqualTypeOf<'USD' | 'VES'>()
    expectTypeOf<keyof Service>().toEqualTypeOf<Exclude<keyof BindingsServiceSummary, 'createdAt' | 'updatedAt'>>()
  })

  it('ServiceInput y ServiceListFilter de model son los de bindings', () => {
    expectTypeOf<ServiceInput>().toEqualTypeOf<BindingsServiceInput>()
    expectTypeOf<ServiceListFilter>().toEqualTypeOf<BindingsServiceFilter>()
  })

  it('los comandos de recursos exponen sus tipos', () => {
    expectTypeOf<BindingsResourceKind>().toEqualTypeOf<'cabin' | 'manicure'>()
    expectTypeOf<BindingsResourceSummary>().toEqualTypeOf<{
      id: number
      name: string
      kind: BindingsResourceKind
      active: boolean
      createdAt: string
      updatedAt: string
    }>()
    expectTypeOf<BindingsResourceInput>().toEqualTypeOf<{ name: string; kind: BindingsResourceKind }>()
    expectTypeOf<BindingsResourceUpdate>().toEqualTypeOf<{ id: number; name: string; kind: BindingsResourceKind }>()
    expectTypeOf<BindingsResourceFilter>().toEqualTypeOf<{ includeInactive: boolean }>()
    expectTypeOf<BindingsResourceActivation>().toEqualTypeOf<{ id: number; active: boolean }>()
    expectTypeOf(commands.listResources).parameter(0).toEqualTypeOf<BindingsResourceFilter>()
    expectTypeOf(commands.createResource).parameter(0).toEqualTypeOf<BindingsResourceInput>()
    expectTypeOf(commands.updateResource).parameter(0).toEqualTypeOf<BindingsResourceUpdate>()
    expectTypeOf(commands.setResourceActive).parameter(0).toEqualTypeOf<BindingsResourceActivation>()
  })

  it('Resource de model se deriva de ResourceSummary sin marcas de tiempo', () => {
    expectTypeOf<Resource>().toEqualTypeOf<Omit<BindingsResourceSummary, 'createdAt' | 'updatedAt'>>()
    expectTypeOf<keyof Resource>().toEqualTypeOf<Exclude<keyof BindingsResourceSummary, 'createdAt' | 'updatedAt'>>()
    expectTypeOf<Resource['kind']>().toEqualTypeOf<BindingsResourceKind>()
  })

  it('ResourceKind, ResourceInput y ResourceListFilter de model son los de bindings', () => {
    expectTypeOf<ResourceKind>().toEqualTypeOf<BindingsResourceKind>()
    expectTypeOf<ResourceInput>().toEqualTypeOf<BindingsResourceInput>()
    expectTypeOf<ResourceListFilter>().toEqualTypeOf<BindingsResourceFilter>()
  })

  it('los comandos de métodos de pago exponen sus tipos', () => {
    expectTypeOf<BindingsPaymentMethodSummary>().toEqualTypeOf<{
      id: number
      name: string
      active: boolean
      createdAt: string
      updatedAt: string
    }>()
    expectTypeOf<BindingsPaymentMethodInput>().toEqualTypeOf<{ name: string }>()
    expectTypeOf<BindingsPaymentMethodUpdate>().toEqualTypeOf<{ id: number; name: string }>()
    expectTypeOf<BindingsPaymentMethodFilter>().toEqualTypeOf<{ includeInactive: boolean }>()
    expectTypeOf<BindingsPaymentMethodActivation>().toEqualTypeOf<{ id: number; active: boolean }>()
    expectTypeOf(commands.listPaymentMethods).parameter(0).toEqualTypeOf<BindingsPaymentMethodFilter>()
    expectTypeOf(commands.createPaymentMethod).parameter(0).toEqualTypeOf<BindingsPaymentMethodInput>()
    expectTypeOf(commands.updatePaymentMethod).parameter(0).toEqualTypeOf<BindingsPaymentMethodUpdate>()
    expectTypeOf(commands.setPaymentMethodActive).parameter(0).toEqualTypeOf<BindingsPaymentMethodActivation>()
  })

  it('los comandos de tasas de cambio exponen sus tipos', () => {
    expectTypeOf<BindingsExchangeRate>().toEqualTypeOf<{ date: string; rateBsPerUsdE4: number }>()
    expectTypeOf(commands.getRate).parameter(0).toEqualTypeOf<string>()
    expectTypeOf(commands.upsertRate).parameter(0).toEqualTypeOf<string>()
    expectTypeOf(commands.upsertRate).parameter(1).toEqualTypeOf<number>()
  })

  it('listAudit expone AuditQuery, AuditPage, AuditEntry y sus enums', () => {
    expectTypeOf<BindingsAuditEntity>().toEqualTypeOf<
      | 'user'
      | 'role'
      | 'system'
      | 'client'
      | 'service'
      | 'resource'
      | 'appointment'
      | 'payment'
      | 'payment_method'
      | 'exchange_rate'
    >()
    expectTypeOf<BindingsAuditAction>().toEqualTypeOf<
      | 'login_succeeded'
      | 'login_failed'
      | 'login_locked_out'
      | 'logout'
      | 'session_locked'
      | 'session_unlocked'
      | 'unlock_failed'
      | 'owner_created'
      | 'recovery_used'
      | 'recovery_failed'
      | 'user_created'
      | 'user_updated'
      | 'password_reset'
      | 'role_created'
      | 'role_permissions_changed'
      | 'clock_rollback'
      | 'create'
      | 'update'
      | 'deactivate'
      | 'soft_delete'
      | 'reactivate'
      | 'void'
      | 'backup_created'
      | 'backup_restored'
    >()
    expectTypeOf<BindingsAuditQuery>().toEqualTypeOf<{ beforeId: number | null; limit: number }>()
    expectTypeOf<BindingsAuditPage>().toEqualTypeOf<{ entries: BindingsAuditEntry[]; nextBeforeId: number | null }>()
    expectTypeOf<BindingsAuditEntry['action']>().toEqualTypeOf<BindingsAuditAction>()
    expectTypeOf<BindingsAuditEntry['entity']>().toEqualTypeOf<BindingsAuditEntity>()
    expectTypeOf(commands.listAudit).parameter(0).toEqualTypeOf<BindingsAuditQuery>()
  })

  it('PermissionKey es equivalente en ambos sentidos', () => {
    expectTypeOf<BindingsPermissionKey>().toEqualTypeOf<PermissionKey>()
  })

  it('el AppErrorCode de bindings está incluido en el de model', () => {
    expectTypeOf<BindingsAppErrorCode>().toExtend<AppErrorCode>()
    expectTypeOf<'internal'>().toExtend<AppErrorCode>()
  })

  it('AppError de bindings es asignable al de model', () => {
    expectTypeOf<BindingsAppError>().toExtend<AppError>()
  })
})
