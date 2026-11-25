import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AppErrorException,
  UNEXPECTED_ERROR,
  appErrorOf,
  err,
  failureOf,
  mapOk,
  ok,
  unwrap,
  validationError,
} from './result'

describe('ok', () => {
  it('envuelve el dato con status ok', () => {
    expect(ok({ id: 1 })).toEqual({ status: 'ok', data: { id: 1 } })
  })
})

describe('err', () => {
  it('sin detalles deja field y entityIds en null', () => {
    expect(err('notFound', 'No existe')).toEqual({
      status: 'error',
      error: { code: 'notFound', message: 'No existe', field: null, entityIds: null },
    })
  })

  it('conserva field y entityIds', () => {
    const result = err('overlap', 'Solapa', { field: 'startsAt', entityIds: [3, 4] })
    expect(result).toEqual({
      status: 'error',
      error: { code: 'overlap', message: 'Solapa', field: 'startsAt', entityIds: [3, 4] },
    })
  })

  it('copia entityIds para no compartir la referencia de entrada', () => {
    const ids = [1, 2]
    const result = err('overlap', 'Solapa', { entityIds: ids })
    ids.push(99)
    expect(result.status === 'error' && result.error.entityIds).toEqual([1, 2])
  })
})

describe('failureOf', () => {
  it('devuelve null cuando la operación termina', async () => {
    expect(await failureOf(async () => 1)).toBeNull()
  })

  it('devuelve el AppError de una AppErrorException', async () => {
    const appError = { code: 'notFound', message: 'No existe', field: null, entityIds: null } as const
    const failing = async () => {
      throw new AppErrorException(appError)
    }
    expect(await failureOf(failing)).toEqual(appError)
  })

  it('devuelve UNEXPECTED_ERROR ante cualquier otra excepción', async () => {
    const failing = async () => {
      throw new Error('boom')
    }
    expect(await failureOf(failing)).toBe(UNEXPECTED_ERROR)
    expect(UNEXPECTED_ERROR).toEqual({
      code: 'validation',
      message: 'No se pudo completar la operación',
      field: null,
      entityIds: null,
    })
  })
})

describe('validationError', () => {
  const schema = z.object({ name: z.string().min(1, 'Nombre requerido'), items: z.array(z.object({ qty: z.number() })) })

  it('usa la ruta y el mensaje de la primera incidencia', () => {
    const parsed = schema.safeParse({ name: '', items: [] })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(validationError(parsed.error.issues)).toEqual({
      status: 'error',
      error: { code: 'validation', message: 'Nombre requerido', field: 'name', entityIds: null },
    })
  })

  it('une rutas anidadas con punto', () => {
    const parsed = schema.safeParse({ name: 'a', items: [{ qty: 'x' }] })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const result = validationError(parsed.error.issues)
    expect(result.status === 'error' && result.error.field).toBe('items.0.qty')
  })

  it('ruta vacía deja field en null', () => {
    const parsed = z.string().min(3, 'Muy corto').safeParse('a')
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const result = validationError(parsed.error.issues)
    expect(result.status === 'error' && result.error.field).toBeNull()
  })

  it('sin incidencias devuelve un mensaje genérico', () => {
    const result = validationError([])
    expect(result.status === 'error' && result.error.message).toBe('Datos inválidos')
  })
})

describe('unwrap', () => {
  it('devuelve el dato de un resultado correcto', () => {
    expect(unwrap(ok('listo'))).toBe('listo')
  })

  it('lanza AppErrorException con el error de dominio', () => {
    const failing = err('forbidden', 'Sin permiso')
    expect(() => unwrap(failing)).toThrow(AppErrorException)
    try {
      unwrap(failing)
    } catch (caught) {
      expect(appErrorOf(caught)?.code).toBe('forbidden')
    }
  })
})

describe('AppErrorException', () => {
  it('es un Error con el mensaje del AppError', () => {
    const exception = new AppErrorException({ code: 'notFound', message: 'No hay', field: null, entityIds: null })
    expect(exception).toBeInstanceOf(Error)
    expect(exception.message).toBe('No hay')
    expect(exception.appError.code).toBe('notFound')
  })
})

describe('appErrorOf', () => {
  it('devuelve null para errores ajenos al dominio', () => {
    expect(appErrorOf(new Error('boom'))).toBeNull()
    expect(appErrorOf(undefined)).toBeNull()
    expect(appErrorOf('texto')).toBeNull()
  })
})

describe('mapOk', () => {
  it('transforma el dato de un resultado ok', () => {
    expect(mapOk(ok(2), (value) => value * 10)).toEqual({ status: 'ok', data: 20 })
  })

  it('devuelve el mismo error sin invocar la transformación', () => {
    const failure = err<number>('validation', 'mal', { field: 'name' })
    let invocations = 0

    const mapped = mapOk(failure, (value) => {
      invocations += 1
      return value
    })

    expect(mapped).toBe(failure)
    expect(invocations).toBe(0)
  })
})
