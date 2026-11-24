import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AppError, PaymentMethodInput } from '@/lib/model'
import { PaymentMethodForm } from './payment-method-form'

const EMPTY: PaymentMethodInput = { name: '' }

function renderForm(options: { initialValue?: PaymentMethodInput; result?: AppError | null } = {}) {
  const onSubmit = vi.fn().mockResolvedValue(options.result ?? null)
  const onCancel = vi.fn()
  const user = userEvent.setup()
  render(
    <PaymentMethodForm
      initialValue={options.initialValue ?? EMPTY}
      submitLabel="Guardar"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  )
  return { onSubmit, onCancel, user }
}

function failure(code: AppError['code'], field: string | null, message: string): AppError {
  return { code, message, field, entityIds: null }
}

async function submitName(user: UserEvent, name: string) {
  await user.type(screen.getByLabelText('Nombre'), name)
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
}

describe('PaymentMethodForm', () => {
  it('muestra el campo etiquetado con el valor inicial', () => {
    renderForm({ initialValue: { name: 'Zelle' } })

    expect(screen.getByLabelText('Nombre')).toHaveValue('Zelle')
  })

  it('valida el nombre vacío sin llamar a onSubmit', async () => {
    const { onSubmit, user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Ingresa el nombre del método de pago')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('envía el nombre recortado', async () => {
    const { onSubmit, user } = renderForm()

    await submitName(user, '  Cripto  ')

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ name: 'Cripto' })
  })

  it('muestra como alerta un error que no es de validación del nombre', async () => {
    const { user } = renderForm({ result: failure('forbidden', null, 'No tienes permiso para esta acción') })

    await submitName(user, 'Cripto')

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
    expect(screen.getByLabelText('Nombre')).toBeValid()
  })

  it('muestra como alerta un error ajeno aunque traiga field name', async () => {
    const { user } = renderForm({ result: failure('forbidden', 'name', 'No tienes permiso para esta acción') })

    await submitName(user, 'Cripto')

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
    expect(screen.getByLabelText('Nombre')).toBeValid()
  })

  it('muestra como alerta un validation de otro campo', async () => {
    const { user } = renderForm({ result: failure('validation', 'id', 'Revisa el dato ingresado') })

    await submitName(user, 'Cripto')

    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa el dato ingresado')
    expect(screen.getByLabelText('Nombre')).toBeValid()
  })

  it('ubica junto al campo el validation de name y no lo muestra como alerta', async () => {
    const message = 'Nombre repetido'
    const { user } = renderForm({ result: failure('validation', 'name', message) })

    await submitName(user, 'Cripto')

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveAccessibleDescription(message))
    expect(screen.getByLabelText('Nombre')).toBeInvalid()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('no muestra alerta cuando onSubmit tiene éxito', async () => {
    const { onSubmit, user } = renderForm()

    await submitName(user, 'Cripto')

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Cancelar invoca onCancel', async () => {
    const { onCancel, user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
