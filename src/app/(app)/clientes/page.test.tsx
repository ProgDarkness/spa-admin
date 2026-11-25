import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import ClientsPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('ClientsPage', () => {
  it('muestra el heading y la lista de clientes', async () => {
    renderWithProviders(<ClientsPage />, { as: 'recepcion' })

    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'María González' })).toBeInTheDocument()
  })

  it('con permiso de escritura permite crear un cliente desde el diálogo', async () => {
    const { user } = renderWithProviders(<ClientsPage />, { as: 'recepcion' })

    await user.click(await screen.findByRole('button', { name: 'Nuevo cliente' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
    await user.type(within(dialog).getByLabelText('Nombre'), 'Valentina')
    await user.type(within(dialog).getByLabelText('Apellido'), 'Ríos')
    await user.type(within(dialog).getByLabelText('Cédula'), 'V-30111222')
    await user.type(within(dialog).getByLabelText('Teléfono'), '0414-5550000')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cliente' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('link', { name: 'Valentina Ríos' })).toBeInTheDocument()
    expect(getState().clients).toHaveLength(10)
  })

  it('un alta con la cédula de un cliente eliminado ofrece reactivarlo y lo devuelve a la lista', async () => {
    const { user } = renderWithProviders(<ClientsPage />, { as: 'recepcion' })

    await user.click(await screen.findByRole('button', { name: 'Nuevo cliente' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
    await user.type(within(dialog).getByLabelText('Nombre'), 'Otro')
    await user.type(within(dialog).getByLabelText('Apellido'), 'Nombre')
    await user.type(within(dialog).getByLabelText('Cédula'), 'v-26789012')
    await user.type(within(dialog).getByLabelText('Teléfono'), '0414-5550000')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cliente' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Reactivar cliente' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('link', { name: 'Carlos Mendoza' })).toBeInTheDocument()
  })

  it('Editar abre el diálogo con los datos y guarda los cambios', async () => {
    const { user } = renderWithProviders(<ClientsPage />, { as: 'recepcion' })

    await user.click(await screen.findByRole('button', { name: 'Editar María González' }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar cliente' })
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('María')
    await user.clear(within(dialog).getByLabelText('Nombre'))
    await user.type(within(dialog).getByLabelText('Nombre'), 'Mariela')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cliente' }))

    expect(await screen.findByRole('link', { name: 'Mariela González' })).toBeInTheDocument()
  })

  it('sin permiso de escritura oculta alta, edición y eliminación', async () => {
    renderWithProviders(<ClientsPage />, { as: 'lectura' })

    await screen.findByRole('link', { name: 'María González' })
    expect(screen.queryByRole('button', { name: 'Nuevo cliente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument()
  })
})
