import { describe, expect, it, vi } from 'vitest'
import { callBackend, settle } from './ipc'
import type { AppError, Result } from './model'

const INTERNAL_ERROR: AppError = {
  code: 'internal',
  message: 'No se pudo completar la operación',
  field: null,
  entityIds: null,
}

const BACKEND_VALIDATION: AppError = {
  code: 'validation',
  message: 'Revisa el dato ingresado',
  field: 'priceCents',
  entityIds: [3, 4],
}

describe('settle', () => {
  it('convierte un error lanzado en AppError internal sin filtrar la causa', async () => {
    const result = await settle<number>(() => Promise.reject(new Error('detalle sensible de la base')))

    expect(result).toEqual({ status: 'error', error: INTERNAL_ERROR })
    expect(JSON.stringify(result)).not.toContain('sensible')
  })

  it('convierte también un rechazo que no es Error', async () => {
    const result = await settle<number>(() => Promise.reject('texto suelto'))

    expect(result).toEqual({ status: 'error', error: INTERNAL_ERROR })
  })

  it('convierte una excepción síncrona de la operación', async () => {
    const result = await settle<number>(() => {
      throw new Error('falla antes de devolver la promesa')
    })

    expect(result).toEqual({ status: 'error', error: INTERNAL_ERROR })
  })

  it('deja pasar un resultado ok sin cambios', async () => {
    const okResult: Result<{ id: number }> = { status: 'ok', data: { id: 7 } }

    expect(await settle(() => Promise.resolve(okResult))).toBe(okResult)
  })

  it('deja llegar intacto un error del backend con code, field y entityIds', async () => {
    const errorResult: Result<number> = { status: 'error', error: BACKEND_VALIDATION }

    const result = await settle(() => Promise.resolve(errorResult))

    expect(result).toBe(errorResult)
    expect(result).toEqual({ status: 'error', error: BACKEND_VALIDATION })
  })
})

describe('callBackend', () => {
  it('refleja los datos en el mock solo cuando la respuesta es ok', async () => {
    const reflect = vi.fn()

    const result = await callBackend(() => Promise.resolve<Result<number>>({ status: 'ok', data: 42 }), reflect)

    expect(result).toEqual({ status: 'ok', data: 42 })
    expect(reflect).toHaveBeenCalledTimes(1)
    expect(reflect).toHaveBeenCalledWith(42)
  })

  it('no refleja nada cuando el backend responde con error', async () => {
    const reflect = vi.fn()

    const result = await callBackend(
      () => Promise.resolve<Result<number>>({ status: 'error', error: BACKEND_VALIDATION }),
      reflect,
    )

    expect(result).toEqual({ status: 'error', error: BACKEND_VALIDATION })
    expect(reflect).not.toHaveBeenCalled()
  })

  it('no refleja nada y devuelve internal cuando la operación lanza', async () => {
    const reflect = vi.fn()

    const result = await callBackend<number>(() => Promise.reject(new Error('caída del canal')), reflect)

    expect(result).toEqual({ status: 'error', error: INTERNAL_ERROR })
    expect(reflect).not.toHaveBeenCalled()
  })

  it('propaga la excepción del reflejo en lugar de tragarla', async () => {
    const failingReflect = () => {
      throw new Error('espejo roto')
    }

    await expect(
      callBackend(() => Promise.resolve<Result<number>>({ status: 'ok', data: 1 }), failingReflect),
    ).rejects.toThrow('espejo roto')
  })
})
