import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import type { AppError } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { AppointmentForm } from './appointment-form'

const START = '2026-11-13T09:00'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function renderForm(options: { result?: AppError | null; resourceId?: number | null } = {}) {
  const onSubmit = vi.fn().mockResolvedValue(options.result ?? null)
  const onCancel = vi.fn()
  const rendered = renderWithProviders(
    <AppointmentForm
      initialValue={{ resourceId: options.resourceId ?? null, startsAt: START }}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
    { as: 'recepcion' },
  )
  return { onSubmit, onCancel, ...rendered }
}

function optionNamesOf(label: string): string[] {
  return within(screen.getByLabelText(label)).getAllByRole('option').map((option) => option.textContent ?? '')
}

async function fillValidForm(user: ReturnType<typeof renderForm>['user']) {
  await screen.findByRole('option', { name: 'María González' })
  await user.selectOptions(screen.getByLabelText('Cliente'), 'María González')
  await user.selectOptions(screen.getByLabelText('Servicio'), 'Limpieza facial (ejemplo)')
  await user.selectOptions(screen.getByLabelText('Recurso'), 'Cabina 2')
}

describe('AppointmentForm', () => {
  it('muestra los campos etiquetados con la fecha inicial', async () => {
    renderForm()

    expect(await screen.findByLabelText('Cliente')).toBeInTheDocument()
    expect(screen.getByLabelText('Servicio')).toBeInTheDocument()
    expect(screen.getByLabelText('Recurso')).toBeInTheDocument()
    expect(screen.getByLabelText('Fecha y hora')).toHaveValue(START)
    expect(screen.getByLabelText('Notas')).toHaveValue('')
  })

  it('el selector de servicios no ofrece servicios inactivos', async () => {
    renderForm()
    await screen.findByRole('option', { name: 'Limpieza facial (ejemplo)' })

    const names = optionNamesOf('Servicio')
    expect(names).not.toContain('Peeling químico (ejemplo)')
    expect(names).toContain('Masaje relajante (ejemplo)')
  })

  it('el selector de recursos no ofrece recursos inactivos', async () => {
    renderForm()
    await screen.findByRole('option', { name: 'Cabina 1' })

    expect(optionNamesOf('Recurso')).not.toContain('Manicure (Rosa)')
  })

  it('el selector de clientes no ofrece clientes borrados', async () => {
    renderForm()
    await screen.findByRole('option', { name: 'María González' })

    expect(optionNamesOf('Cliente')).not.toContain('Carlos Mendoza')
  })

  it('preselecciona el recurso inicial', async () => {
    renderForm({ resourceId: 2 })
    await screen.findByRole('option', { name: 'Cabina 2' })

    await waitFor(() => expect(screen.getByLabelText('Recurso')).toHaveValue('2'))
  })

  it('valida los campos obligatorios sin llamar a onSubmit', async () => {
    const { onSubmit, user } = renderForm()
    await screen.findByRole('option', { name: 'María González' })

    await user.click(screen.getByRole('button', { name: 'Crear cita' }))

    expect(await screen.findByText('Selecciona un cliente')).toBeInTheDocument()
    expect(screen.getByText('Selecciona un servicio')).toBeInTheDocument()
    expect(screen.getByText('Selecciona un recurso')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rechaza minutos que no son múltiplo de 5', async () => {
    const { onSubmit, user } = renderForm()
    await fillValidForm(user)

    fireEvent.change(screen.getByLabelText('Fecha y hora'), { target: { value: '2026-11-13T09:03' } })
    await user.click(screen.getByRole('button', { name: 'Crear cita' }))

    expect(await screen.findByText('La hora debe estar en bloques de 5 minutos')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('envía el AppointmentInput con ids numéricos y notas recortadas', async () => {
    const { onSubmit, user } = renderForm()
    await fillValidForm(user)
    await user.type(screen.getByLabelText('Notas'), '  traer bata ')

    await user.click(screen.getByRole('button', { name: 'Crear cita' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      clientId: 1,
      serviceId: 1,
      resourceId: 2,
      startsAt: START,
      notes: 'traer bata',
    })
  })

  it('muestra el error del api junto al campo indicado', async () => {
    const { user } = renderForm({
      result: { code: 'notFound', message: 'El cliente no existe', field: 'clientId', entityIds: null },
    })
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Crear cita' }))

    expect(await screen.findByText('El cliente no existe')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('en un solape muestra el mensaje en la hora y las citas en conflicto', async () => {
    const { user } = renderForm({
      result: { code: 'overlap', message: 'El recurso ya tiene una cita en ese horario', field: 'startsAt', entityIds: [41, 42] },
    })
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Crear cita' }))

    expect(await screen.findByText('El recurso ya tiene una cita en ese horario')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Citas en conflicto: #41, #42')
  })

  it('muestra en una alerta el error sin campo', async () => {
    const { user } = renderForm({
      result: { code: 'forbidden', message: 'No tienes permiso para esta acción', field: null, entityIds: null },
    })
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Crear cita' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
  })

  it('Cancelar invoca onCancel', async () => {
    const { onCancel, user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
