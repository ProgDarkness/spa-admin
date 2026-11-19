import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { clientRecordHref } from '@/lib/routes'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { ClientList } from './client-list'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function rowOf(name: string): HTMLElement {
  return screen.getByRole('row', { name: new RegExp(name) })
}

describe('ClientList lectura', () => {
  it('lista solo clientes activos con enlace a la ficha', async () => {
    renderWithProviders(<ClientList canWrite={false} onEditAction={vi.fn()} />, { as: 'lectura' })

    const link = await screen.findByRole('link', { name: 'María González' })
    expect(link).toHaveAttribute('href', clientRecordHref(1))
    expect(screen.getAllByRole('row')).toHaveLength(9)
    expect(screen.queryByText(/Mendoza/)).not.toBeInTheDocument()
  })

  it('muestra cédula y teléfono', async () => {
    renderWithProviders(<ClientList canWrite={false} onEditAction={vi.fn()} />, { as: 'lectura' })

    const row = await screen.findByRole('row', { name: /María González/ })
    expect(within(row).getByText('V-12345678')).toBeInTheDocument()
    expect(within(row).getByText('0414-1234567')).toBeInTheDocument()
  })

  it('no muestra acciones de escritura sin permiso', async () => {
    renderWithProviders(<ClientList canWrite={false} onEditAction={vi.fn()} />, { as: 'lectura' })

    await screen.findByRole('link', { name: 'María González' })
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument()
  })

  it('filtra en vivo por nombre sin importar acentos ni mayúsculas', async () => {
    const { user } = renderWithProviders(<ClientList canWrite={false} onEditAction={vi.fn()} />, { as: 'lectura' })
    await screen.findByRole('link', { name: 'María González' })

    await user.type(screen.getByRole('searchbox', { name: 'Buscar clientes' }), 'JOSE')

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getByRole('link', { name: 'José Rodríguez' })).toBeInTheDocument()
  })

  it.each([
    ['hernandez', 'Carla Hernández'],
    ['v-1678', 'Ana Pérez'],
    ['0426-56', 'Carla Hernández'],
  ])('filtra por "%s"', async (query, fullName) => {
    const { user } = renderWithProviders(<ClientList canWrite={false} onEditAction={vi.fn()} />, { as: 'lectura' })
    await screen.findByRole('link', { name: 'María González' })

    await user.type(screen.getByRole('searchbox', { name: 'Buscar clientes' }), query)

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getByRole('link', { name: fullName })).toBeInTheDocument()
  })

  it('muestra mensaje cuando no hay coincidencias', async () => {
    const { user } = renderWithProviders(<ClientList canWrite={false} onEditAction={vi.fn()} />, { as: 'lectura' })
    await screen.findByRole('link', { name: 'María González' })

    await user.type(screen.getByRole('searchbox', { name: 'Buscar clientes' }), 'zzzz')

    const message = await screen.findByText('No se encontraron clientes')
    expect(message.closest('[data-slot="empty-state"]')).not.toBeNull()
  })

  it('Mostrar eliminados incluye al cliente eliminado con su insignia', async () => {
    const { user } = renderWithProviders(<ClientList canWrite={false} onEditAction={vi.fn()} />, { as: 'lectura' })
    await screen.findByRole('link', { name: 'María González' })

    await user.click(screen.getByRole('checkbox', { name: 'Mostrar eliminados' }))

    const row = await screen.findByRole('row', { name: /Carlos Mendoza/ })
    expect(within(row).getByText('Eliminado')).toBeInTheDocument()
  })
})

describe('ClientList escritura', () => {
  it('Editar llama onEditAction con el cliente', async () => {
    const onEditAction = vi.fn()
    const { user } = renderWithProviders(<ClientList canWrite onEditAction={onEditAction} />, { as: 'recepcion' })

    await user.click(await screen.findByRole('button', { name: 'Editar María González' }))

    expect(onEditAction).toHaveBeenCalledWith(expect.objectContaining({ id: 1, firstName: 'María' }))
  })

  it('Eliminar pide confirmación accesible y no borra hasta confirmar', async () => {
    const { user } = renderWithProviders(<ClientList canWrite onEditAction={vi.fn()} />, { as: 'recepcion' })

    await user.click(await screen.findByRole('button', { name: 'Eliminar María González' }))

    const dialog = await screen.findByRole('dialog', { name: '¿Eliminar a María González?' })
    expect(within(dialog).getByText('Podrás reactivarlo.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
    expect(getState().clients.find((client) => client.id === 1)?.deletedAt).toBeNull()
  })

  it('Cancelar cierra la confirmación sin borrar', async () => {
    const { user } = renderWithProviders(<ClientList canWrite onEditAction={vi.fn()} />, { as: 'recepcion' })
    await user.click(await screen.findByRole('button', { name: 'Eliminar María González' }))

    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(getState().clients.find((client) => client.id === 1)?.deletedAt).toBeNull()
    expect(screen.getByRole('link', { name: 'María González' })).toBeInTheDocument()
  })

  it('confirmar aplica borrado lógico, oculta la fila y cierra el diálogo', async () => {
    const { user } = renderWithProviders(<ClientList canWrite onEditAction={vi.fn()} />, { as: 'recepcion' })
    await user.click(await screen.findByRole('button', { name: 'Eliminar María González' }))

    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(screen.queryByRole('link', { name: 'María González' })).not.toBeInTheDocument())
    expect(getState().clients.find((client) => client.id === 1)?.deletedAt).toBe('2026-11-12T09:00')
    expect(getState().clients).toHaveLength(9)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('un cliente eliminado ofrece Reactivar en vez de Editar/Eliminar', async () => {
    const { user } = renderWithProviders(<ClientList canWrite onEditAction={vi.fn()} />, { as: 'recepcion' })
    await screen.findByRole('link', { name: 'María González' })
    await user.click(screen.getByRole('checkbox', { name: 'Mostrar eliminados' }))

    const row = await screen.findByRole('row', { name: /Carlos Mendoza/ })
    expect(within(row).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Reactivar Carlos Mendoza' }))

    await waitFor(() => expect(getState().clients.find((client) => client.id === 9)?.deletedAt).toBeNull())
    expect(within(rowOf('Carlos Mendoza')).queryByText('Eliminado')).not.toBeInTheDocument()
  })

  it('muestra alerta si la acción falla', async () => {
    const { user } = renderWithProviders(<ClientList canWrite onEditAction={vi.fn()} />, { as: 'recepcion' })
    await user.click(await screen.findByRole('button', { name: 'Eliminar María González' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(getState().clients[0]?.deletedAt).not.toBeNull())
    await user.click(screen.getByRole('checkbox', { name: 'Mostrar eliminados' }))
    const { commit } = await import('@/lib/mock/store')
    commit({ ...getState(), sessionUserId: null })

    await user.click(await screen.findByRole('button', { name: 'Reactivar María González' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Debes iniciar sesión')
  })
})
