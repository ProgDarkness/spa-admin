import { mockIPC } from '@tauri-apps/api/mocks'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { ServiceForm } from './service-form'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function renderForm(service = null as Parameters<typeof ServiceForm>[0]['service'], as: 'propietaria' | 'lectura' = 'propietaria') {
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  const rendered = renderWithProviders(<ServiceForm service={service} onSaved={onSaved} onCancel={onCancel} />, { as })
  return { ...rendered, onSaved, onCancel }
}

describe('ServiceForm', () => {
  it('muestra campos etiquetados vacíos al crear', () => {
    renderForm()

    expect(screen.getByLabelText('Nombre')).toHaveValue('')
    expect(screen.getByLabelText('Precio (USD)')).toHaveValue('')
    expect(screen.getByLabelText('Duración (minutos)')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Crear servicio' })).toBeInTheDocument()
  })

  it('precarga los valores al editar', () => {
    renderForm({ id: 1, name: 'Limpieza', priceCents: 3_550, currency: 'USD', durationMin: 60, active: true })

    expect(screen.getByLabelText('Nombre')).toHaveValue('Limpieza')
    expect(screen.getByLabelText('Precio (USD)')).toHaveValue('35.50')
    expect(screen.getByLabelText('Duración (minutos)')).toHaveValue('60')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
  })

  it('valida campos vacíos sin llamar al api', async () => {
    const { user, onSaved } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(await screen.findByText('Ingresa el nombre del servicio')).toBeInTheDocument()
    expect(screen.getByText('Ingresa un precio válido')).toBeInTheDocument()
    expect(screen.getByText('La duración debe ser un múltiplo de 5 minutos')).toBeInTheDocument()
    expect(getState().services).toHaveLength(8)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('crea el servicio con centavos y llama onSaved', async () => {
    const { user, onSaved } = renderForm()
    await user.type(screen.getByLabelText('Nombre'), 'Depilación')
    await user.type(screen.getByLabelText('Precio (USD)'), '25,50')
    await user.type(screen.getByLabelText('Duración (minutos)'), '30')

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(getState().services.at(-1)).toMatchObject({ name: 'Depilación', priceCents: 2_550, durationMin: 30, active: true })
  })

  it('edita el servicio existente y conserva su id', async () => {
    const { user, onSaved } = renderForm({ id: 1, name: 'Limpieza', priceCents: 3_500, currency: 'USD', durationMin: 60, active: true })
    await user.clear(screen.getByLabelText('Precio (USD)'))
    await user.type(screen.getByLabelText('Precio (USD)'), '40')

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(getState().services[0]).toMatchObject({ id: 1, name: 'Limpieza', priceCents: 4_000 })
    expect(getState().services).toHaveLength(8)
  })

  it('muestra el error del api como alerta cuando falta permiso', async () => {
    const { user, onSaved } = renderForm(null, 'lectura')
    await user.type(screen.getByLabelText('Nombre'), 'Depilación')
    await user.type(screen.getByLabelText('Precio (USD)'), '25')
    await user.type(screen.getByLabelText('Duración (minutos)'), '30')

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
    expect(onSaved).not.toHaveBeenCalled()
    expect(getState().services).toHaveLength(8)
  })

  it('muestra como alerta el validation con field id si el servicio editado ya no existe', async () => {
    const { user, onSaved } = renderForm({ id: 999, name: 'Fantasma', priceCents: 1_000, currency: 'USD', durationMin: 30, active: true })

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa el dato ingresado')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('muestra el error de nombre repetido junto al campo Nombre y no como alerta', async () => {
    const { user, onSaved } = renderForm()
    await user.type(screen.getByLabelText('Nombre'), 'LIMPIEZA FACIAL (EJEMPLO)')
    await user.type(screen.getByLabelText('Precio (USD)'), '25')
    await user.type(screen.getByLabelText('Duración (minutos)'), '30')

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(await screen.findByText('Revisa el dato ingresado')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(getState().services).toHaveLength(8)
  })

  it.each([
    ['priceCents', 'Precio (USD)'],
    ['durationMin', 'Duración (minutos)'],
  ] as const)('ubica el validation del backend para %s junto al campo %s', async (field, label) => {
    mockIPC(() => {
      throw { code: 'validation', message: `Dato rechazado: ${field}`, field, entityIds: null }
    })
    const { user } = renderForm()
    await user.type(screen.getByLabelText('Nombre'), 'Depilación')
    await user.type(screen.getByLabelText('Precio (USD)'), '25')
    await user.type(screen.getByLabelText('Duración (minutos)'), '30')

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(await screen.findByText(`Dato rechazado: ${field}`)).toBeInTheDocument()
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('muestra como alerta un validation con un campo que el formulario no tiene', async () => {
    mockIPC(() => {
      throw { code: 'validation', message: 'Campo ajeno', field: 'otroCampo', entityIds: null }
    })
    const { user } = renderForm()
    await user.type(screen.getByLabelText('Nombre'), 'Depilación')
    await user.type(screen.getByLabelText('Precio (USD)'), '25')
    await user.type(screen.getByLabelText('Duración (minutos)'), '30')

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Campo ajeno')
  })

  it('solo ubica junto al campo los errores validation: un forbidden con field sigue siendo alerta', async () => {
    mockIPC(() => {
      throw { code: 'forbidden', message: 'Sin permiso', field: 'name', entityIds: null }
    })
    const { user } = renderForm()
    await user.type(screen.getByLabelText('Nombre'), 'Depilación')
    await user.type(screen.getByLabelText('Precio (USD)'), '25')
    await user.type(screen.getByLabelText('Duración (minutos)'), '30')

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin permiso')
    expect(screen.getByLabelText('Nombre')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('muestra el mensaje genérico cuando el canal falla', async () => {
    mockIPC(() => {
      throw new Error('canal caído')
    })
    const { user } = renderForm()
    await user.type(screen.getByLabelText('Nombre'), 'Depilación')
    await user.type(screen.getByLabelText('Precio (USD)'), '25')
    await user.type(screen.getByLabelText('Duración (minutos)'), '30')

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la operación')
  })

  it('Cancelar llama onCancel sin tocar el estado', async () => {
    const { user, onCancel } = renderForm()
    const before = getState()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(getState()).toBe(before)
  })
})
