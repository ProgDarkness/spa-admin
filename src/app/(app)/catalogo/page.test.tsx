import { mockIPC } from '@tauri-apps/api/mocks'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { storedAppointments } from '@/test/appointment-fixtures'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { unauthenticatedError } from '@/test/ipc/ipc-errors'
import CatalogPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('CatalogPage lectura', () => {
  it('muestra solo servicios activos sin acciones de escritura', async () => {
    renderWithProviders(<CatalogPage />, { as: 'lectura' })

    expect(await screen.findByRole('row', { name: /Limpieza facial/ })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(1 + 7)
    expect(screen.queryByText(/Peeling químico/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo servicio' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Desactivar/ })).not.toBeInTheDocument()
  })

  it('muestra los métodos de pago en una sección de solo lectura', async () => {
    renderWithProviders(<CatalogPage />, { as: 'lectura' })

    const section = await screen.findByRole('region', { name: 'Métodos de pago' })
    const items = await within(section).findAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['Efectivo', 'Pago móvil', 'Punto de venta', 'Transferencia', 'Zelle'])
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
  })

  it('el heading principal es Catálogo', async () => {
    renderWithProviders(<CatalogPage />, { as: 'lectura' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Catálogo' })).toBeInTheDocument()
  })
})

describe('CatalogPage recepción', () => {
  it('no ve acciones de escritura', async () => {
    renderWithProviders(<CatalogPage />, { as: 'recepcion' })

    await screen.findByRole('row', { name: /Limpieza facial/ })
    expect(screen.queryByRole('button', { name: 'Nuevo servicio' })).not.toBeInTheDocument()
  })
})

describe('CatalogPage propietaria', () => {
  it('lista también los inactivos y muestra las acciones', async () => {
    renderWithProviders(<CatalogPage />, { as: 'propietaria' })

    const inactiveRow = await screen.findByRole('row', { name: /Peeling químico/ })
    expect(within(inactiveRow).getByText('Inactivo')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(1 + 8)
    expect(screen.getByRole('button', { name: 'Nuevo servicio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactivar Peeling químico (ejemplo)' })).toBeInTheDocument()
  })

  it('crea un servicio desde el diálogo y lo muestra en la tabla', async () => {
    const { user } = renderWithProviders(<CatalogPage />, { as: 'propietaria' })
    await user.click(await screen.findByRole('button', { name: 'Nuevo servicio' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' })
    await user.type(within(dialog).getByLabelText('Nombre'), 'Depilación')
    await user.type(within(dialog).getByLabelText('Precio (USD)'), '25')
    await user.type(within(dialog).getByLabelText('Duración (minutos)'), '30')

    await user.click(within(dialog).getByRole('button', { name: 'Crear servicio' }))

    expect(await screen.findByRole('row', { name: /Depilación/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(getState().services).toHaveLength(9)
  })

  it('edita un servicio y no altera los snapshots de las citas existentes', async () => {
    const { user } = renderWithProviders(<CatalogPage />, { as: 'propietaria' })
    const appointmentsBefore = await storedAppointments()
    await user.click(await screen.findByRole('button', { name: 'Editar Limpieza facial (ejemplo)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar servicio' })
    expect(within(dialog).getByLabelText('Precio (USD)')).toHaveValue('35.00')
    await user.clear(within(dialog).getByLabelText('Precio (USD)'))
    await user.type(within(dialog).getByLabelText('Precio (USD)'), '99')

    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(getState().services[0]?.priceCents).toBe(9_900))
    const appointmentsAfter = await storedAppointments()
    expect(appointmentsAfter).toEqual(appointmentsBefore)
    expect(appointmentsAfter.filter((appointment) => appointment.serviceId === 1).every((appointment) => appointment.priceCentsSnapshot === 3_500)).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancelar el diálogo lo cierra sin cambios', async () => {
    const { user } = renderWithProviders(<CatalogPage />, { as: 'propietaria' })
    await user.click(await screen.findByRole('button', { name: 'Nuevo servicio' }))
    const dialog = await screen.findByRole('dialog')
    const before = getState()

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(getState()).toBe(before)
  })

  it('desactiva un servicio sin borrarlo y luego lo reactiva', async () => {
    const { user } = renderWithProviders(<CatalogPage />, { as: 'propietaria' })
    await user.click(await screen.findByRole('button', { name: 'Desactivar Limpieza facial (ejemplo)' }))

    const row = await screen.findByRole('row', { name: /Limpieza facial/ })
    await waitFor(() => expect(within(row).getByText('Inactivo')).toBeInTheDocument())
    expect(getState().services).toHaveLength(8)

    await user.click(screen.getByRole('button', { name: 'Reactivar Limpieza facial (ejemplo)' }))

    await waitFor(() => expect(within(screen.getByRole('row', { name: /Limpieza facial/ })).getByText('Activo')).toBeInTheDocument())
  })

  it('muestra como alerta el error del api al desactivar sin sesión', async () => {
    renderWithProviders(<CatalogPage />, { as: 'propietaria' })
    const button = await screen.findByRole('button', { name: 'Desactivar Limpieza facial (ejemplo)' })
    mockIPC(() => {
      throw unauthenticatedError()
    })

    fireEvent.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent('Inicia sesión para continuar')
  })
})
