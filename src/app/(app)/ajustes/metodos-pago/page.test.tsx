import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as paymentMethodsApi from '@/features/payment-methods/api'
import { setPaymentMethodActive } from '@/features/payment-methods/api'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { PaymentMethod, Result } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { deferred } from '@/test/deferred'
import { renderWithProviders } from '@/test/render'
import { signInAs } from '@/test/session'
import PaymentMethodsPage from './page'

vi.mock('@/features/payment-methods/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/payment-methods/api')>()
  return { ...original, listPaymentMethods: vi.fn(original.listPaymentMethods) }
})

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

const DENIED_MESSAGE = 'No tienes permiso para esta acción'

function revokeSessionPermissions(): ReturnType<typeof getState> {
  const original = getState()
  commit({
    ...original,
    users: original.users.map((candidate) =>
      candidate.id === original.sessionUserId ? { ...candidate, permissions: [] } : candidate,
    ),
  })
  return original
}

function stateOf(id: number) {
  return getState().paymentMethods.find((method) => method.id === id)
}

async function deactivateMethods(...ids: number[]): Promise<void> {
  signInAs('propietaria')
  for (const id of ids) await setPaymentMethodActive(id, false)
}

describe('PaymentMethodsPage', () => {
  it('muestra el heading y lista los métodos de pago', async () => {
    renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })

    expect(screen.getByRole('heading', { level: 1, name: 'Métodos de pago' })).toBeInTheDocument()
    expect(await screen.findByRole('row', { name: /Efectivo/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Pago móvil/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Zelle/ })).toBeInTheDocument()
  })

  it('muestra el estado de carga sin el estado vacío mientras lista', async () => {
    const pending = deferred<Result<PaymentMethod[]>>()
    vi.mocked(paymentMethodsApi.listPaymentMethods).mockReturnValueOnce(pending.promise)
    renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })

    expect(await screen.findByRole('status')).toHaveTextContent('Cargando métodos de pago…')
    expect(screen.queryByText('No hay métodos de pago para mostrar')).not.toBeInTheDocument()
    pending.resolve({ status: 'ok', data: [] })
  })

  it('muestra la alerta cuando el listado falla por permisos', async () => {
    signInAs('propietaria')
    revokeSessionPermissions()
    renderWithProviders(<PaymentMethodsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(DENIED_MESSAGE)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('el filtro Mostrar inactivos oculta los inactivos', async () => {
    await deactivateMethods(1)
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })

    await user.click(screen.getByRole('checkbox', { name: 'Mostrar inactivos' }))

    await waitFor(() => expect(screen.queryByRole('row', { name: /Efectivo/ })).not.toBeInTheDocument())
    expect(screen.getByRole('row', { name: /Zelle/ })).toBeInTheDocument()
  })

  it('muestra el estado vacío cuando no hay métodos', async () => {
    await deactivateMethods(1, 2, 3, 4, 5)
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })
    await user.click(screen.getByRole('checkbox', { name: 'Mostrar inactivos' }))

    expect(await screen.findByText('No hay métodos de pago para mostrar')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('sin catalog.write lista pero no ofrece crear, editar ni desactivar', async () => {
    renderWithProviders(<PaymentMethodsPage />, { as: 'lectura' })

    expect(await screen.findByRole('row', { name: /Efectivo/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo método de pago' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar|Desactivar|Reactivar/ })).not.toBeInTheDocument()
  })

  it('crea un método de pago válido desde el formulario', async () => {
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })

    await user.click(screen.getByRole('button', { name: 'Nuevo método de pago' }))
    await user.type(screen.getByLabelText('Nombre'), 'Cripto')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    expect(await screen.findByRole('row', { name: /Cripto/ })).toBeInTheDocument()
    expect(getState().paymentMethods).toHaveLength(6)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('valida el nombre vacío sin llamar al backend y deja abierto el diálogo', async () => {
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })

    await user.click(screen.getByRole('button', { name: 'Nuevo método de pago' }))
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    expect(await screen.findByText('Ingresa el nombre del método de pago')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(getState().paymentMethods).toHaveLength(5)
  })

  it('ubica junto al campo Nombre el rechazo de Rust por un nombre repetido', async () => {
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })

    await user.click(screen.getByRole('button', { name: 'Nuevo método de pago' }))
    await user.type(screen.getByLabelText('Nombre'), 'efectivo')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveAccessibleDescription('Revisa el dato ingresado'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(getState().paymentMethods).toHaveLength(5)
  })

  it('edita un método con su nombre precargado', async () => {
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })

    await user.click(screen.getByRole('button', { name: 'Editar Efectivo' }))
    const nameInput = screen.getByLabelText('Nombre')
    expect(nameInput).toHaveValue('Efectivo')
    await user.clear(nameInput)
    await user.type(nameInput, 'Efectivo USD')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('row', { name: /Efectivo USD/ })).toBeInTheDocument()
    expect(stateOf(1)?.name).toBe('Efectivo USD')
  })

  it('desactiva con confirmación y conserva el método si se cancela', async () => {
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Zelle/ })

    await user.click(screen.getByRole('button', { name: 'Desactivar Zelle' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(stateOf(3)?.active).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Desactivar Zelle' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }))

    await waitFor(() => expect(stateOf(3)?.active).toBe(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reactiva un método inactivo sin confirmación', async () => {
    await deactivateMethods(1)
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })

    await user.click(screen.getByRole('button', { name: 'Reactivar Efectivo' }))

    await waitFor(() => expect(stateOf(1)?.active).toBe(true))
    expect(within(await screen.findByRole('row', { name: /Efectivo/ })).getByText('Activo')).toBeInTheDocument()
  })

  it('muestra el mensaje genérico del backend sin filtrar datos internos y lo limpia al reintentar', async () => {
    await deactivateMethods(1)
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })
    const original = revokeSessionPermissions()

    await user.click(screen.getByRole('button', { name: 'Reactivar Efectivo' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(DENIED_MESSAGE)
    expect(alert.textContent).toBe(DENIED_MESSAGE)
    commit(original)
    await user.click(screen.getByRole('button', { name: 'Reactivar Efectivo' }))
    await waitFor(() => expect(stateOf(1)?.active).toBe(true))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('el diálogo tiene descripción accesible y no emite avisos de Radix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { user } = renderWithProviders(<PaymentMethodsPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Efectivo/ })

    await user.click(screen.getByRole('button', { name: 'Nuevo método de pago' }))

    expect(await screen.findByRole('dialog', { name: 'Nuevo método de pago' })).toHaveAccessibleDescription(
      'Define el nombre del método de pago.',
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
