import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { Payment } from '@/lib/model'
import { formatCents } from '@/lib/money'
import { AppErrorException, err } from '@/lib/result'
import { appointmentTemplate, resetWithEmptyAgenda, seedAppointments } from '@/test/appointment-fixtures'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import * as paymentsApi from '../api'
import { VoidDialog } from './void-dialog'

const PAYMENT: Payment = {
  id: 7,
  appointmentId: 100,
  methodId: 1,
  currency: 'USD',
  amountCents: 2000,
  rateBsPerUsdE4: null,
  usdEquivalentCents: 2000,
  paidAt: '2026-11-12T09:00',
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
}

const CONFIRM = 'Confirmar anulación'
const REASON = 'Motivo de la anulación'
const REASON_REQUIRED = 'Indica el motivo de la anulación'

beforeEach(() => {
  vi.restoreAllMocks()
  resetWithEmptyAgenda()
  seedAppointments(appointmentTemplate({ id: 100 }))
  commit({ ...getState(), payments: [PAYMENT] })
  installDevIpc()
})

async function openDialog() {
  const onClose = vi.fn()
  const rendered = renderWithProviders(<VoidDialog payment={PAYMENT} onClose={onClose} />, { as: 'recepcion' })
  await screen.findByRole('dialog', { name: 'Anular pago' })
  return { ...rendered, onClose }
}

describe('VoidDialog', () => {
  it('describe el monto del pago que se anulará', async () => {
    await openDialog()

    const amount = formatCents(2000, 'USD').replace(/\s+/g, ' ')
    expect(screen.getByRole('dialog').textContent?.replace(/\s+/g, ' ')).toContain(`El pago de ${amount} quedará tachado`)
  })

  it('con el motivo vacío muestra el error del campo, no llama al api y no cierra', async () => {
    const spy = vi.spyOn(paymentsApi, 'voidPayment')
    const { user, onClose } = await openDialog()

    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText(REASON_REQUIRED)).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(getState().payments[0]?.voidedAt).toBeNull()
  })

  it('un motivo de solo espacios se rechaza igual que vacío', async () => {
    const { user, onClose } = await openDialog()

    await user.type(screen.getByLabelText(REASON), '   ')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText(REASON_REQUIRED)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('un motivo de más de 200 caracteres se rechaza', async () => {
    const { user, onClose } = await openDialog()

    await user.click(screen.getByLabelText(REASON))
    await user.paste('x'.repeat(201))
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText('El motivo es demasiado largo')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('con motivo válido anula el pago con el motivo recortado y cierra', async () => {
    const { user, onClose } = await openDialog()

    await user.type(screen.getByLabelText(REASON), '  Cobro duplicado  ')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(getState().payments[0]).toMatchObject({ voidReason: 'Cobro duplicado' })
    expect(getState().payments[0]?.voidedAt).not.toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('si el api falla con un error de aplicación muestra su mensaje en una alerta y no cierra', async () => {
    vi.spyOn(paymentsApi, 'voidPayment').mockResolvedValue(err('forbidden', 'No tienes permiso para anular pagos'))
    const { user, onClose } = await openDialog()

    await user.type(screen.getByLabelText(REASON), 'Error de digitación')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para anular pagos')
    expect(onClose).not.toHaveBeenCalled()
    expect(getState().payments[0]?.voidedAt).toBeNull()
  })

  it('si el api lanza un error inesperado muestra el mensaje genérico', async () => {
    vi.spyOn(paymentsApi, 'voidPayment').mockRejectedValue(new Error('boom'))
    const { user, onClose } = await openDialog()

    await user.type(screen.getByLabelText(REASON), 'Motivo')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo anular el pago')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('el error de Rust sobre reason se muestra bajo el campo y no como alerta', async () => {
    vi.spyOn(paymentsApi, 'voidPayment').mockResolvedValue(err('validation', 'Motivo rechazado por Rust', { field: 'reason' }))
    const { user, onClose } = await openDialog()

    await user.type(screen.getByLabelText(REASON), 'Motivo')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText('Motivo rechazado por Rust')).toBeInTheDocument()
    expect(screen.getByLabelText(REASON)).toHaveAccessibleDescription('Motivo rechazado por Rust')
    expect(screen.getByText('Motivo rechazado por Rust')).toHaveAttribute('aria-live', 'polite')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('un error viejo de reason no convive con la alerta alreadyVoided del siguiente envío', async () => {
    vi.spyOn(paymentsApi, 'voidPayment')
      .mockResolvedValueOnce(err('validation', 'Motivo rechazado por Rust', { field: 'reason' }))
      .mockResolvedValueOnce(err('alreadyVoided', 'El pago ya fue anulado', { entityIds: [7] }))
    const { user } = await openDialog()
    await user.type(screen.getByLabelText(REASON), 'Motivo')
    await user.click(screen.getByRole('button', { name: CONFIRM }))
    await screen.findByText('Motivo rechazado por Rust')

    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El pago ya fue anulado')
    expect(screen.queryByText('Motivo rechazado por Rust')).not.toBeInTheDocument()
  })

  it('alreadyVoided de Rust se muestra como alerta con su mensaje y no cierra', async () => {
    vi.spyOn(paymentsApi, 'voidPayment').mockResolvedValue(err('alreadyVoided', 'El pago ya fue anulado', { entityIds: [7] }))
    const { user, onClose } = await openDialog()

    await user.type(screen.getByLabelText(REASON), 'Motivo')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El pago ya fue anulado')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('un AppErrorException lanzado se traduce a su mensaje', async () => {
    vi.spyOn(paymentsApi, 'voidPayment').mockRejectedValue(
      new AppErrorException({ code: 'validation', message: 'Ya está anulado', field: null, entityIds: null }),
    )
    const { user } = await openDialog()

    await user.type(screen.getByLabelText(REASON), 'Motivo')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya está anulado')
  })

  it('un nuevo envío limpia la alerta previa y permite reintentar con éxito', async () => {
    vi.spyOn(paymentsApi, 'voidPayment').mockResolvedValueOnce(err('forbidden', 'Fallo temporal'))
    const { user, onClose } = await openDialog()
    await user.type(screen.getByLabelText(REASON), 'Motivo')

    await user.click(screen.getByRole('button', { name: CONFIRM }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fallo temporal')
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Fallo temporal')).not.toBeInTheDocument()
  })

  it('un error de validación posterior limpia la alerta del api', async () => {
    vi.spyOn(paymentsApi, 'voidPayment').mockResolvedValue(err('forbidden', 'Fallo temporal'))
    const { user } = await openDialog()
    const reason = screen.getByLabelText(REASON)
    await user.type(reason, 'Motivo')
    await user.click(screen.getByRole('button', { name: CONFIRM }))
    await screen.findByRole('alert')

    await user.clear(reason)
    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText(REASON_REQUIRED)).toBeInTheDocument()
    expect(screen.queryByText('Fallo temporal')).not.toBeInTheDocument()
  })

  it('Cancelar cierra sin llamar al api', async () => {
    const spy = vi.spyOn(paymentsApi, 'voidPayment')
    const { user, onClose } = await openDialog()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('Escape cierra el diálogo', async () => {
    const { user, onClose } = await openDialog()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('deshabilita la confirmación mientras la anulación está en curso y la rehabilita al terminar', async () => {
    let release: (value: Awaited<ReturnType<typeof paymentsApi.voidPayment>>) => void = () => undefined
    vi.spyOn(paymentsApi, 'voidPayment').mockReturnValue(new Promise((resolve) => (release = resolve)))
    const { user } = await openDialog()
    await user.type(screen.getByLabelText(REASON), 'Motivo')

    await user.click(screen.getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(screen.getByRole('button', { name: CONFIRM })).toBeDisabled())
    release(err('forbidden', 'x'))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: CONFIRM })).toBeEnabled()
  })
})
