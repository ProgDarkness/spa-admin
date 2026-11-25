import { describe, expect, it } from 'vitest'
import { createSharedRows } from './shared-rows'

describe('createSharedRows', () => {
  it('empieza vacío cuando no recibe filas iniciales', () => {
    expect(createSharedRows<number>().read()).toEqual([])
  })

  it('devuelve las filas iniciales', () => {
    expect(createSharedRows([1, 2]).read()).toEqual([1, 2])
  })

  it('write reemplaza el contenido visible para los lectores', () => {
    const rows = createSharedRows([1])
    const reader = rows.read

    rows.write([7, 8])

    expect(reader()).toEqual([7, 8])
  })
})
