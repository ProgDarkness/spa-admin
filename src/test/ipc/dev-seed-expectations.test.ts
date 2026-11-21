import { describe, expect, it } from 'vitest'
import {
  EXPECTED_DEV_RESOURCES,
  EXPECTED_DEV_SERVICES,
  resourceIdentitiesOf,
  serviceIdentitiesOf,
} from './dev-seed-expectations'

describe('resourceIdentitiesOf', () => {
  it('conserva solo id, name, kind y active de cada fila', () => {
    const rows = [{ id: 1, name: 'A', kind: 'cabin', active: true, createdAt: 'x', updatedAt: 'y' }]

    expect(resourceIdentitiesOf(rows)).toEqual([{ id: 1, name: 'A', kind: 'cabin', active: true }])
  })

  it.each([[null], [undefined], ['texto'], [{}], [42]])('devuelve vacío si lo recibido no es un arreglo (%s)', (value) => {
    expect(resourceIdentitiesOf(value)).toEqual([])
  })

  it('devuelve vacío para un arreglo vacío', () => {
    expect(resourceIdentitiesOf([])).toEqual([])
  })
})

describe('serviceIdentitiesOf', () => {
  it('conserva solo id y name de cada fila', () => {
    const rows = [{ id: 2, name: 'Corte', priceCents: 100, durationMin: 30 }]

    expect(serviceIdentitiesOf(rows)).toEqual([{ id: 2, name: 'Corte' }])
  })

  it('devuelve vacío si lo recibido no es un arreglo', () => {
    expect(serviceIdentitiesOf(null)).toEqual([])
  })
})

describe('esperados del seed de desarrollo', () => {
  it('los recursos esperados son Cabina 1, Cabina 2 y Manicure (Rosa) inactivo con ids 1 a 3', () => {
    expect(EXPECTED_DEV_RESOURCES.map(({ id, name, active }) => [id, name, active])).toEqual([
      [1, 'Cabina 1', true],
      [2, 'Cabina 2', true],
      [3, 'Manicure (Rosa)', false],
    ])
  })

  it('los servicios esperados provienen del seed y no están vacíos', () => {
    expect(EXPECTED_DEV_SERVICES.length).toBeGreaterThan(0)
    expect(EXPECTED_DEV_SERVICES.every((service) => typeof service.name === 'string' && service.name !== '')).toBe(true)
  })
})
