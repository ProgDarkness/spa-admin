import { describe, expect, it } from 'vitest'
import { QUERY_KEYS } from './query-keys'

describe('QUERY_KEYS', () => {
  it('expone cada dominio con su string estable', () => {
    expect(QUERY_KEYS).toEqual({
      appointments: 'appointments',
      backupStatus: 'backupStatus',
      clientHistory: 'clientHistory',
      clients: 'clients',
      metrics: 'metrics',
      paymentMethods: 'paymentMethods',
      payments: 'payments',
      rates: 'rates',
      resources: 'resources',
      services: 'services',
    })
  })

  it('no repite valores entre dominios', () => {
    const values = Object.values(QUERY_KEYS)
    expect(new Set(values).size).toBe(values.length)
  })
})
