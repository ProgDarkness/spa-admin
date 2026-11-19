import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { Payment } from '@/lib/model'
import { formatCents as formatCentsRaw } from '@/lib/money'
import { appointmentTemplate, resetWithEmptyAgenda, seedAppointments } from '@/test/appointment-fixtures'
import { renderWithProviders } from '@/test/render'
import { PaymentList } from './payment-list'

const APPOINTMENT_ID = 100

function formatCents(...args: Parameters<typeof formatCentsRaw>): string {
  return formatCentsRaw(...args).replace(/\s+/g, ' ')
}

function payment(overrides: Partial<Payment>): Payment {
  return {
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
    ...overrides,
  }
}

const USD_ACTIVE = payment({ id: 1 })
const VES_ACTIVE = payment({
  id: 2,
  methodId: 2,
  currency: 'VES',
  amountCents: 73000,
  rateBsPerUsdE4: 365000,
  usdEquivalentCents: 2000,
})
const USD_VOIDED = payment({
  id: 3,
  amountCents: 999,
  usdEquivalentCents: 999,
  voidedAt: '2026-11-12T09:30',
  voidedBy: 1,
  voidReason: 'Monto digitado por error',
})

beforeEach(() => {
  resetWithEmptyAgenda()
  seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID }))
  commit({ ...getState(), payments: [USD_ACTIVE, VES_ACTIVE, USD_VOIDED] })
})

describe('PaymentList', () => {
  it('muestra cada pago con monto, método, tasa y equivalente USD para bolívares', async () => {
    renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]!).getByText(formatCents(2000, 'USD'))).toBeInTheDocument()
    expect(within(items[0]!).getByText(/Efectivo/)).toBeInTheDocument()
    expect(within(items[1]!).getByText(formatCents(73000, 'VES'))).toBeInTheDocument()
    expect(within(items[1]!).getByText(/Pago móvil/)).toBeInTheDocument()
    expect(within(items[1]!).getByText(/Tasa 36,50/)).toBeInTheDocument()
    expect(within(items[1]!).getByText(new RegExp(`≈ ${formatCents(2000, 'USD')}`))).toBeInTheDocument()
  })

  it('muestra Método eliminado cuando el método ya cargó y no existe', async () => {
    commit({ ...getState(), payments: [payment({ id: 9, methodId: 999 })] })
    renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    expect(await screen.findByText(/Método eliminado/)).toBeInTheDocument()
  })

  it('tacha los anulados y muestra el motivo', async () => {
    renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    const items = await screen.findAllByRole('listitem')
    const voided = items[2]!
    expect(voided).toHaveAttribute('data-voided', 'true')
    expect(within(voided).getByRole('deletion')).toHaveTextContent(formatCents(999, 'USD'))
    expect(items[0]).toHaveAttribute('data-voided', 'false')
    expect(within(voided).getByText(/Anulado: Monto digitado por error/)).toBeInTheDocument()
    expect(within(voided).queryByRole('button', { name: /Anular/ })).not.toBeInTheDocument()
  })

  it('totaliza solo los activos por moneda y el equivalente USD', async () => {
    renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    const totals = await screen.findByRole('group', { name: 'Totales cobrados' })
    expect(within(totals).getByText(`Total USD: ${formatCents(2000, 'USD')}`)).toBeInTheDocument()
    expect(within(totals).getByText(`Total VES: ${formatCents(73000, 'VES')}`)).toBeInTheDocument()
    expect(within(totals).getByText(`Total equivalente en USD: ${formatCents(4000, 'USD')}`)).toBeInTheDocument()
  })

  it('informa cuando la cita no tiene pagos', async () => {
    commit({ ...getState(), payments: [] })
    renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    const message = await screen.findByText('Esta cita aún no tiene pagos.')
    expect(message.closest('[data-slot="empty-state"]')).not.toBeNull()
    expect(screen.queryByRole('group', { name: 'Totales cobrados' })).not.toBeInTheDocument()
  })

  it('ofrece Anular solo a quien puede escribir pagos', async () => {
    const { unmount } = renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })
    expect(await screen.findAllByRole('button', { name: /Anular pago/ })).toHaveLength(2)
    unmount()

    renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'lectura' })
    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('button', { name: /Anular pago/ })).not.toBeInTheDocument()
  })

  it('anula un pago desde el diálogo exigiendo motivo y lo tacha', async () => {
    const { user } = renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    await user.click((await screen.findAllByRole('button', { name: /Anular pago/ }))[0]!)
    await user.click(screen.getByRole('button', { name: 'Confirmar anulación' }))
    expect(await screen.findByText('Indica el motivo de la anulación')).toBeInTheDocument()
    expect(getState().payments[0]?.voidedAt).toBeNull()

    await user.type(screen.getByLabelText('Motivo de la anulación'), 'Cobro duplicado')
    await user.click(screen.getByRole('button', { name: 'Confirmar anulación' }))

    const first = (await screen.findAllByRole('listitem'))[0]!
    expect(await within(first).findByText(/Anulado: Cobro duplicado/)).toBeInTheDocument()
    expect(getState().payments[0]).toMatchObject({ voidedBy: 2, voidReason: 'Cobro duplicado' })
    const totals = screen.getByRole('group', { name: 'Totales cobrados' })
    expect(within(totals).getByText(`Total USD: ${formatCents(0, 'USD')}`)).toBeInTheDocument()
  })

  it('cierra el diálogo de anulación al cancelar sin anular', async () => {
    const { user } = renderWithProviders(<PaymentList appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    await user.click((await screen.findAllByRole('button', { name: /Anular pago/ }))[0]!)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getState().payments[0]?.voidedAt).toBeNull()
  })
})
