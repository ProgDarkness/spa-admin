import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PaymentMethodSummary } from '@/lib/bindings'
import { getState, resetStore } from '@/lib/mock/store'
import { createPaymentMethod, listPaymentMethods } from './api'

const INSTANT = '2026-11-12T09:00:00Z'
const ALL = { includeInactive: true }

function summary(overrides: Partial<PaymentMethodSummary>): PaymentMethodSummary {
  return { id: 1, name: 'Método real', active: true, createdAt: INSTANT, updatedAt: INSTANT, ...overrides }
}

function rustReturns(rows: readonly PaymentMethodSummary[]): void {
  mockIPC((cmd) => (cmd === 'list_payment_methods' ? rows : null))
}

beforeEach(resetStore)
afterEach(() => clearMocks())

describe('listPaymentMethods reemplaza el espejo', () => {
  it('deja en el store exactamente lo que devuelve Rust', async () => {
    rustReturns([summary({ id: 1 }), summary({ id: 40, name: 'Otro real' })])

    await listPaymentMethods(ALL)

    expect(getState().paymentMethods.map((method) => [method.id, method.name])).toEqual([
      [1, 'Método real'],
      [40, 'Otro real'],
    ])
  })

  it('vacía el store cuando Rust no devuelve métodos', async () => {
    rustReturns([])

    await listPaymentMethods(ALL)

    expect(getState().paymentMethods).toEqual([])
  })

  it('create sigue haciendo upsert sin tocar el resto', async () => {
    const before = getState().paymentMethods
    mockIPC((cmd) => (cmd === 'create_payment_method' ? summary({ id: 90 }) : null))

    await createPaymentMethod({ name: 'Método real' })

    expect(getState().paymentMethods).toHaveLength(before.length + 1)
  })
})
