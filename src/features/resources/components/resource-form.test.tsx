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

function validationFailure(field: string | null, message: string): AppError {
  return { code: 'validation', message, field, entityIds: null }
}

function controlOf(label: string): HTMLElement {
  return label === 'Tipo' ? screen.getByRole('combobox', { name: label }) : screen.getByLabelText(label)
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

  it.each([
    ['name', 'Nombre'],
    ['kind', 'Tipo'],
  ] as const)('ubica validation del campo %s junto a su control y no como alerta', async (field, label) => {
    const message = `Copy del backend para ${field}`
    const { user } = renderForm({ result: validationFailure(field, message) })

    await user.type(screen.getByLabelText('Nombre'), 'Sala')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(controlOf(label)).toHaveAccessibleDescription(message))
    expect(controlOf(label)).toBeInvalid()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('no marca el otro campo cuando el error es de un solo campo', async () => {
    const { user } = renderForm({ result: validationFailure('name', 'Nombre repetido') })

    await user.type(screen.getByLabelText('Nombre'), 'Sala')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toBeInvalid())
    expect(screen.getByRole('combobox', { name: 'Tipo' })).not.toBeInvalid()
  })

  it.each(['id', 'priceCents', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'muestra como alerta un validation con field %s que no es del formulario',
    async (field) => {
      const { user } = renderForm({ result: validationFailure(field, 'Revisa el dato ingresado') })

      await user.type(screen.getByLabelText('Nombre'), 'Sala')
      await user.click(screen.getByRole('button', { name: 'Guardar' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Revisa el dato ingresado')
      expect(screen.getByLabelText('Nombre')).toBeValid()
    },
  )

  it('muestra como alerta un validation sin campo', async () => {
    const { user } = renderForm({ result: validationFailure(null, 'Revisa el dato ingresado') })

    await user.type(screen.getByLabelText('Nombre'), 'Sala')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa el dato ingresado')
  })

  it('muestra como alerta un error que no es de validación aunque traiga field name', async () => {
    const { user } = renderForm({
      result: { code: 'forbidden', message: 'No tienes permiso para esta acción', field: 'name', entityIds: null },
    })

    await user.type(screen.getByLabelText('Nombre'), 'Sala')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
    expect(screen.getByLabelText('Nombre')).toBeValid()
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
