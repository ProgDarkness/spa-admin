import { screen, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import { appointmentTemplate, resetWithEmptyAgenda, seedAppointments } from '@/test/appointment-fixtures'
import { renderWithProviders } from '@/test/render'
import { PaymentsButton } from './payments-button'
import { PaymentsDialog } from './payments-dialog'

const APPOINTMENT_ID = 100

beforeEach(() => {
  resetWithEmptyAgenda()
  seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID, status: 'cancelled' }))
  commit({ ...getState(), payments: [] })
})

function ControlledDialog() {
  const [open, setOpen] = useState(true)
  return <PaymentsDialog appointmentId={APPOINTMENT_ID} open={open} onOpenChange={setOpen} />
}

describe('PaymentsDialog', () => {
  it('muestra lista y formulario a quien puede cobrar', async () => {
    renderWithProviders(<ControlledDialog />, { as: 'recepcion' })

    const dialog = await screen.findByRole('dialog', { name: 'Pagos de la cita' })
    expect(await within(dialog).findByText('Esta cita aún no tiene pagos.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Registrar pago' })).toBeInTheDocument()
  })

  it('permite registrar un pago en una cita cancelada y verlo en la lista', async () => {
    const { user } = renderWithProviders(<ControlledDialog />, { as: 'recepcion' })
    await screen.findByRole('option', { name: 'Efectivo' })

    await user.selectOptions(screen.getByLabelText('Método de pago'), 'Efectivo')
    await user.type(screen.getByLabelText('Monto'), '10')
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(await screen.findAllByRole('listitem')).toHaveLength(1)
    expect(getState().payments[0]?.appointmentId).toBe(APPOINTMENT_ID)
  })

  it('oculta el formulario a quien solo puede leer', async () => {
    renderWithProviders(<ControlledDialog />, { as: 'lectura' })

    const dialog = await screen.findByRole('dialog', { name: 'Pagos de la cita' })
    await within(dialog).findByText('Esta cita aún no tiene pagos.')
    expect(within(dialog).queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument()
  })

  it('no renderiza contenido cerrado', () => {
    renderWithProviders(<PaymentsDialog appointmentId={APPOINTMENT_ID} open={false} onOpenChange={() => undefined} />, { as: 'recepcion' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('PaymentsButton', () => {
  it('abre el diálogo de pagos de la cita', async () => {
    const { user } = renderWithProviders(<PaymentsButton appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    await user.click(await screen.findByRole('button', { name: 'Pagos' }))

    expect(await screen.findByRole('dialog', { name: 'Pagos de la cita' })).toBeInTheDocument()
  })

  it('no se muestra sin permiso de lectura de pagos', () => {
    commit({
      ...getState(),
      users: getState().users.map((user) => (user.username === 'lectura' ? { ...user, permissions: ['clients.read'] } : user)),
    })
    renderWithProviders(<PaymentsButton appointmentId={APPOINTMENT_ID} />, { as: 'lectura' })

    expect(screen.queryByRole('button', { name: 'Pagos' })).not.toBeInTheDocument()
  })
})
