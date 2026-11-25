import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setPaymentMethodActive } from '@/features/payment-methods/api'
import { commit, getState } from '@/lib/mock/store'
import { appointmentTemplate, NOW, resetWithEmptyAgenda, seedAppointments } from '@/test/appointment-fixtures'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import { signInAs } from '@/test/session'
import { PaymentForm } from './payment-form'

const APPOINTMENT_ID = 100
const TODAY = NOW.slice(0, 10)

beforeEach(() => {
  resetWithEmptyAgenda()
  seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID }))
  commit({ ...getState(), payments: [] })
  installDevIpc()
})

async function fillAmount(user: ReturnType<typeof renderWithProviders>['user'], text: string) {
  await user.type(screen.getByLabelText('Monto'), text)
}

describe('PaymentForm', () => {
  it('ofrece solo los métodos activos y empieza en USD sin campo de tasa', async () => {
    signInAs('propietaria')
    await setPaymentMethodActive(5, false)
    renderWithProviders(<PaymentForm appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    expect(await screen.findByRole('option', { name: 'Efectivo' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Punto de venta' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Moneda')).toHaveValue('USD')
    expect(screen.queryByLabelText('Tasa (Bs por USD)')).not.toBeInTheDocument()
  })

  it('precarga la tasa del día al elegir bolívares y deja editarla', async () => {
    const { user } = renderWithProviders(<PaymentForm appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    await user.selectOptions(screen.getByLabelText('Moneda'), 'VES')

    const rate = await screen.findByLabelText('Tasa (Bs por USD)')
    await waitFor(() => expect(rate).toHaveValue('36,50'))
    await user.clear(rate)
    await user.type(rate, '37')
    expect(rate).toHaveValue('37')
    expect(screen.queryByText(/Falta la tasa de hoy/)).not.toBeInTheDocument()
  })

  it('avisa que falta la tasa de hoy y deja la tasa vacía', async () => {
    commit({ ...getState(), rates: getState().rates.filter((rate) => rate.date !== TODAY) })
    installDevIpc()
    const { user } = renderWithProviders(<PaymentForm appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    await user.selectOptions(screen.getByLabelText('Moneda'), 'VES')

    expect(await screen.findByText(/Falta la tasa de hoy/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByLabelText('Tasa (Bs por USD)')).toHaveValue('')
  })

  it('registra un pago USD y avisa', async () => {
    const onSaved = vi.fn()
    const { user } = renderWithProviders(<PaymentForm appointmentId={APPOINTMENT_ID} onSaved={onSaved} />, { as: 'recepcion' })
    await screen.findByRole('option', { name: 'Zelle' })

    await user.selectOptions(screen.getByLabelText('Método de pago'), 'Zelle')
    await fillAmount(user, '25,50')
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Pago registrado')
    expect(getState().payments).toMatchObject([
      { appointmentId: APPOINTMENT_ID, methodId: 3, currency: 'USD', amountCents: 2550, rateBsPerUsdE4: null, usdEquivalentCents: 2550 },
    ])
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Monto')).toHaveValue('')
  })

  it('registra un pago VES con la tasa editada', async () => {
    const { user } = renderWithProviders(<PaymentForm appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })
    await screen.findByRole('option', { name: 'Pago móvil' })

    await user.selectOptions(screen.getByLabelText('Método de pago'), 'Pago móvil')
    await user.selectOptions(screen.getByLabelText('Moneda'), 'VES')
    const rate = await screen.findByLabelText('Tasa (Bs por USD)')
    await waitFor(() => expect(rate).toHaveValue('36,50'))
    await user.clear(rate)
    await user.type(rate, '40')
    await fillAmount(user, '800')
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Pago registrado')
    expect(getState().payments[0]).toMatchObject({ currency: 'VES', amountCents: 80000, rateBsPerUsdE4: 400000, usdEquivalentCents: 2000 })
  })

  it('muestra errores de validación por campo sin guardar', async () => {
    const { user } = renderWithProviders(<PaymentForm appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })
    await screen.findByRole('option', { name: 'Zelle' })

    await fillAmount(user, 'abc')
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(await screen.findByText('Ingresa un monto mayor que cero con hasta 2 decimales')).toBeInTheDocument()
    expect(screen.getByText('Selecciona un método de pago')).toBeInTheDocument()
    expect(getState().payments).toEqual([])
  })

  it('muestra el error de dominio rateMissing al enviar VES sin ninguna tasa', async () => {
    commit({ ...getState(), rates: getState().rates.filter((rate) => rate.date !== TODAY) })
    installDevIpc()
    const { user } = renderWithProviders(<PaymentForm appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })
    await screen.findByRole('option', { name: 'Zelle' })

    await user.selectOptions(screen.getByLabelText('Método de pago'), 'Zelle')
    await user.selectOptions(screen.getByLabelText('Moneda'), 'VES')
    await fillAmount(user, '100')
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Falta la tasa de hoy')
    expect(getState().payments).toEqual([])
  })

  it('muestra el error cuando el usuario no tiene permiso de escritura', async () => {
    const { user } = renderWithProviders(<PaymentForm appointmentId={APPOINTMENT_ID} />, { as: 'lectura' })
    await screen.findByRole('option', { name: 'Zelle' })

    await user.selectOptions(screen.getByLabelText('Método de pago'), 'Zelle')
    await fillAmount(user, '10')
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
  })
})
