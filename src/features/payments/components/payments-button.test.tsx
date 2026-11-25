import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import { appointmentTemplate, resetWithEmptyAgenda } from '@/test/appointment-fixtures'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import { PaymentsButton } from './payments-button'

const APPOINTMENT_ID = 100

beforeEach(() => {
  resetWithEmptyAgenda()
  installDevIpc({ appointments: [appointmentTemplate({ id: APPOINTMENT_ID })], payments: [] })
})

describe('PaymentsButton', () => {
  it('muestra el botón Pagos y mantiene el diálogo cerrado inicialmente', async () => {
    renderWithProviders(<PaymentsButton appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    expect(await screen.findByRole('button', { name: 'Pagos' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('abre el diálogo de la cita al pulsar y lo cierra con Escape', async () => {
    const { user } = renderWithProviders(<PaymentsButton appointmentId={APPOINTMENT_ID} />, { as: 'recepcion' })

    await user.click(await screen.findByRole('button', { name: 'Pagos' }))
    expect(await screen.findByRole('dialog', { name: 'Pagos de la cita' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('no renderiza nada sin el permiso payments.read', () => {
    commit({
      ...getState(),
      users: getState().users.map((user) => (user.username === 'lectura' ? { ...user, permissions: ['clients.read'] } : user)),
    })
    const { container } = renderWithProviders(<PaymentsButton appointmentId={APPOINTMENT_ID} />, { as: 'lectura' })

    expect(container).toBeEmptyDOMElement()
  })
})
