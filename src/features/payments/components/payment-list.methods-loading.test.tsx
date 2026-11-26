import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appointmentTemplate, resetWithEmptyAgenda } from '@/test/appointment-fixtures'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import { PaymentList } from './payment-list'

vi.mock('@/features/payment-methods/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/payment-methods/api')>()),
  listPaymentMethods: () => new Promise(() => {}),
}))

const APPOINTMENT_ID = 100

beforeEach(() => {
  resetWithEmptyAgenda()
  installDevIpc({ appointments: [appointmentTemplate({ id: APPOINTMENT_ID })], payments: [
      {
        id: 1,
        appointmentId: APPOINTMENT_ID,
        methodId: 1,
        currency: 'USD',
        amountCents: 2000,
        rateBsPerUsdE4: null,
        usdEquivalentCents: 2000,
        paidAt: '2026-11-12T09:00',
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      },
    ] })
})

describe('PaymentList con métodos de pago cargando', () => {
  it('muestra puntos suspensivos en vez de Método eliminado mientras cargan los métodos', async () => {
    renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    const item = (await screen.findAllByRole('listitem'))[0]!
    expect(within(item).getByText(/·\s*…/)).toBeInTheDocument()
    expect(screen.queryByText(/Método eliminado/)).not.toBeInTheDocument()
  })
})
