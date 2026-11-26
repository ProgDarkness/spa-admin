import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayLocal } from '@/lib/datetime'
import { createSeed } from '@/lib/mock/seed'
import { resetStore } from '@/lib/mock/store'
import { appointmentById, storedAppointments } from '@/test/appointment-fixtures'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import AppointmentsPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
})

function cabinColumn(name: string) {
  return within(screen.getByRole('region', { name: `Recurso ${name}` }))
}

async function goToTomorrow(user: ReturnType<typeof renderWithProviders>['user']) {
  await user.click(screen.getByRole('button', { name: 'Siguiente' }))
}

async function failCancellationOfLuis(user: ReturnType<typeof renderWithProviders>['user']) {
  await goToTomorrow(user)
  const cancelButton = await screen.findByRole('button', { name: 'Cancelar cita de Luis Martínez' })
  const seeded = createSeed(todayLocal()).appointments
  installDevIpc({ appointments: seeded.filter((row) => row.id !== 5) })
  await user.click(cancelButton)
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  installDevIpc({ appointments: seeded })
}

async function expectAlertCleared() {
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
}

describe('AppointmentsPage', () => {
  it('muestra el heading Agenda y la vista día de hoy por recurso', async () => {
    renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })

    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Recurso Cabina 1' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recurso Cabina 2' })).toBeInTheDocument()
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-12')
    expect(await cabinColumn('Cabina 2').findByRole('article', { name: 'Cita de Sofía Ramírez a las 16:00' })).toBeInTheDocument()
  })

  it('Siguiente muestra las citas del día siguiente y Hoy regresa', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await screen.findByRole('region', { name: 'Recurso Cabina 1' })

    await goToTomorrow(user)

    expect(await cabinColumn('Cabina 1').findByRole('article', { name: 'Cita de Luis Martínez a las 16:00' })).toBeInTheDocument()
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-13')

    await user.click(screen.getByRole('button', { name: 'Hoy' }))

    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-12')
  })

  it('el toggle Semana muestra siete días y conserva la fecha al volver a Día', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await goToTomorrow(user)

    await user.click(screen.getByRole('button', { name: 'Semana' }))

    expect(await screen.findAllByRole('region', { name: /^Día / })).toHaveLength(7)
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-13')
    expect(await screen.findByRole('article', { name: 'Cita de Luis Martínez a las 16:00' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Día' }))

    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-13')
    expect(await screen.findByRole('region', { name: 'Recurso Cabina 1' })).toBeInTheDocument()
  })

  it('la vista semana filtra por recurso', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await user.click(screen.getByRole('button', { name: 'Semana' }))
    await screen.findByRole('article', { name: 'Cita de Luis Martínez a las 16:00' })
    await screen.findByRole('option', { name: 'Cabina 2' })

    await user.selectOptions(screen.getByLabelText('Recurso'), 'Cabina 2')

    await waitFor(() => expect(screen.queryByRole('article', { name: 'Cita de Luis Martínez a las 16:00' })).not.toBeInTheDocument())
    expect(screen.getByRole('article', { name: 'Cita de Sofía Ramírez a las 16:00' })).toBeInTheDocument()
  })

  it('la navegación en vista semana avanza siete días', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await user.click(screen.getByRole('button', { name: 'Semana' }))

    await user.click(screen.getByRole('button', { name: 'Siguiente' }))

    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-19')
  })

  it('crea una cita desde un hueco vacío y la muestra en la grilla', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await goToTomorrow(user)

    await user.click(await screen.findByRole('button', { name: 'Crear cita en Cabina 2 a las 10:30' }))

    const dialog = await screen.findByRole('dialog', { name: 'Nueva cita' })
    expect(within(dialog).getByLabelText('Fecha y hora')).toHaveValue('2026-11-13T10:30')
    await within(dialog).findByRole('option', { name: 'María González' })
    await waitFor(() => expect(within(dialog).getByLabelText('Recurso')).toHaveValue('2'))
    await user.selectOptions(within(dialog).getByLabelText('Cliente'), 'María González')
    await user.selectOptions(within(dialog).getByLabelText('Servicio'), 'Limpieza facial (ejemplo)')
    await user.click(within(dialog).getByRole('button', { name: 'Crear cita' }))

    expect(await cabinColumn('Cabina 2').findByRole('article', { name: 'Cita de María González a las 10:30' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await storedAppointments()).toHaveLength(17)
  })

  it('muestra el solape devuelto por el api sin cerrar el formulario', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await goToTomorrow(user)
    await user.click(await screen.findByRole('button', { name: 'Nueva cita' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva cita' })
    await within(dialog).findByRole('option', { name: 'María González' })

    await user.selectOptions(within(dialog).getByLabelText('Cliente'), 'María González')
    await user.selectOptions(within(dialog).getByLabelText('Servicio'), 'Limpieza facial (ejemplo)')
    await user.selectOptions(within(dialog).getByLabelText('Recurso'), 'Cabina 1')
    fireEvent.change(within(dialog).getByLabelText('Fecha y hora'), { target: { value: '2026-11-13T16:30' } })
    await user.click(within(dialog).getByRole('button', { name: 'Crear cita' }))

    expect(await within(dialog).findByText('El recurso ya tiene una cita en ese horario')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Citas en conflicto: #5')
    expect(await storedAppointments()).toHaveLength(16)
  })

  it('cancela una cita y libera su franja', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await goToTomorrow(user)

    await user.click(await screen.findByRole('button', { name: 'Cancelar cita de Luis Martínez' }))

    await waitFor(async () => expect((await appointmentById(5)).status).toBe('cancelled'))
    const card = await screen.findByRole('article', { name: 'Cita de Luis Martínez a las 16:00' })
    expect(card).toHaveTextContent('Cancelada')
    expect(screen.queryByRole('button', { name: 'Cancelar cita de Luis Martínez' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear cita en Cabina 1 a las 16:00' })).toBeInTheDocument()
  })

  it('mueve una cita a otra hora', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await goToTomorrow(user)

    await user.click(await screen.findByRole('button', { name: 'Mover cita de Luis Martínez' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mover cita de Luis Martínez' })
    await within(dialog).findByRole('option', { name: 'Cabina 2' })
    fireEvent.change(within(dialog).getByLabelText('Fecha y hora'), { target: { value: '2026-11-13T11:00' } })
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }))

    expect(await cabinColumn('Cabina 1').findByRole('article', { name: 'Cita de Luis Martínez a las 11:00' })).toBeInTheDocument()
    expect((await appointmentById(5)).endsAt).toBe('2026-11-13T12:00')
  })

  it('el usuario de solo lectura ve la agenda sin acciones de escritura', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'lectura' })
    await goToTomorrow(user)

    expect(await screen.findByRole('article', { name: 'Cita de Luis Martínez a las 16:00' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva cita' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Crear cita en/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancelar cita de/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mover cita de/ })).not.toBeInTheDocument()
  })

  it('muestra un error de carga cuando la lectura falla', async () => {
    renderWithProviders(<AppointmentsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Inicia sesión para continuar')
  })

  it('el diálogo de nueva cita tiene descripción accesible y no emite avisos de Radix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })

    await user.click(await screen.findByRole('button', { name: 'Nueva cita' }))

    const dialog = await screen.findByRole('dialog', { name: 'Nueva cita' })
    expect(dialog).toHaveAccessibleDescription('Elige cliente, servicio, recurso y hora de inicio.')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('AppointmentsPage alerta de acción fallida', () => {
  it('desaparece al crear una cita con éxito', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await failCancellationOfLuis(user)

    await user.click(screen.getByRole('button', { name: 'Nueva cita' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nueva cita' })
    await within(dialog).findByRole('option', { name: 'María González' })
    await user.selectOptions(within(dialog).getByLabelText('Cliente'), 'María González')
    await user.selectOptions(within(dialog).getByLabelText('Servicio'), 'Limpieza facial (ejemplo)')
    await user.selectOptions(within(dialog).getByLabelText('Recurso'), 'Cabina 2')
    fireEvent.change(within(dialog).getByLabelText('Fecha y hora'), { target: { value: '2026-11-13T10:30' } })
    await user.click(within(dialog).getByRole('button', { name: 'Crear cita' }))

    await waitFor(async () => expect(await storedAppointments()).toHaveLength(17))
    await expectAlertCleared()
  })

  it('desaparece al mover una cita con éxito', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await failCancellationOfLuis(user)

    await user.click(screen.getByRole('button', { name: 'Mover cita de Luis Martínez' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mover cita de Luis Martínez' })
    await within(dialog).findByRole('option', { name: 'Cabina 2' })
    fireEvent.change(within(dialog).getByLabelText('Fecha y hora'), { target: { value: '2026-11-13T11:00' } })
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }))

    await waitFor(async () => expect((await appointmentById(5)).endsAt).toBe('2026-11-13T12:00'))
    await expectAlertCleared()
  })

  it('desaparece al cancelar otra cita con éxito', async () => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await failCancellationOfLuis(user)

    await user.click(await screen.findByRole('button', { name: 'Cancelar cita de Luis Martínez' }))

    await waitFor(async () => expect((await appointmentById(5)).status).toBe('cancelled'))
    await expectAlertCleared()
  })

  it.each([
    ['cambiar de fecha', 'Siguiente'],
    ['volver a hoy', 'Hoy'],
    ['cambiar de vista', 'Semana'],
  ])('desaparece al %s', async (_, buttonName) => {
    const { user } = renderWithProviders(<AppointmentsPage />, { as: 'recepcion' })
    await failCancellationOfLuis(user)

    await user.click(screen.getByRole('button', { name: buttonName }))

    await expectAlertCleared()
  })
})
