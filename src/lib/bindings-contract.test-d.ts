import { describe, expectTypeOf, it } from 'vitest'
import type { AppError as BindingsAppError, AppErrorCode as BindingsAppErrorCode } from './bindings'
import type { PermissionKey as BindingsPermissionKey, SessionUser as BindingsSessionUser } from './bindings'
import type { AppError, AppErrorCode, PermissionKey, SessionUser } from './model'

describe('contrato de tipos entre bindings generados y model', () => {
  it('SessionUser es equivalente en ambos sentidos', () => {
    expectTypeOf<BindingsSessionUser>().toEqualTypeOf<SessionUser>()
    expectTypeOf<SessionUser>().toExtend<BindingsSessionUser>()
    expectTypeOf<BindingsSessionUser>().toExtend<SessionUser>()
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
