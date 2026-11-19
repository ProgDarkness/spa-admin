import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AppError, ResourceInput } from '@/lib/model'
import { ResourceForm } from './resource-form'

const EMPTY: ResourceInput = { name: '', kind: 'cabin' }

function renderForm(options: { initialValue?: ResourceInput; result?: AppError | null } = {}) {
  const onSubmit = vi.fn().mockResolvedValue(options.result ?? null)
  const onCancel = vi.fn()
  const user = userEvent.setup()
  render(
    <ResourceForm
      initialValue={options.initialValue ?? EMPTY}
      submitLabel="Guardar"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  )
  return { onSubmit, onCancel, user }
}

describe('ResourceForm', () => {
  it('muestra campos etiquetados con los valores iniciales', () => {
    renderForm({ initialValue: { name: 'Cabina 1', kind: 'manicure' } })

    expect(screen.getByLabelText('Nombre')).toHaveValue('Cabina 1')
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toHaveTextContent('Manicure')
  })

  it('valida el nombre vacío sin llamar a onSubmit', async () => {
    const { onSubmit, user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Ingresa el nombre del recurso')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('envía el nombre recortado y el tipo elegido', async () => {
    const { onSubmit, user } = renderForm()

    await user.type(screen.getByLabelText('Nombre'), '  Sala 7  ')
    await user.click(screen.getByRole('combobox', { name: 'Tipo' }))
    await user.click(await screen.findByRole('option', { name: 'Manicure' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ name: 'Sala 7', kind: 'manicure' })
  })

  it('muestra el error de dominio devuelto por onSubmit', async () => {
    const { user } = renderForm({
      result: { code: 'forbidden', message: 'No tienes permiso para esta acción', field: null, entityIds: null },
    })

    await user.type(screen.getByLabelText('Nombre'), 'Sala')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
  })

  it('no muestra alerta cuando onSubmit tiene éxito', async () => {
    const { onSubmit, user } = renderForm()

    await user.type(screen.getByLabelText('Nombre'), 'Sala')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Cancelar invoca onCancel', async () => {
    const { onCancel, user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
