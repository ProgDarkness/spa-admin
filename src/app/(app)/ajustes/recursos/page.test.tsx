import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as resourcesApi from '@/features/resources/api'
import { todayLocal } from '@/lib/datetime'
import { createSeed } from '@/lib/mock/seed'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Resource, Result } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { deferred } from '@/test/deferred'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import ResourcesPage from './page'

vi.mock('@/features/resources/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/resources/api')>()
  return { ...original, listResources: vi.fn(original.listResources) }
})

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
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
  return getState().resources.find((resource) => resource.id === id)
}

describe('ResourcesPage', () => {
  it('muestra el heading y los recursos incluidos los inactivos', async () => {
    renderWithProviders(<ResourcesPage />, { as: 'propietaria' })

    expect(screen.getByRole('heading', { level: 1, name: 'Recursos' })).toBeInTheDocument()
    expect(await screen.findByRole('row', { name: /Cabina 2/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Manicure \(Rosa\)/ })).toBeInTheDocument()
  })

  it('muestra el estado de carga sin el estado vacío mientras lista', async () => {
    const pending = deferred<Result<Resource[]>>()
    vi.mocked(resourcesApi.listResources).mockReturnValueOnce(pending.promise)
    renderWithProviders(<ResourcesPage />, { as: 'propietaria' })

    expect(await screen.findByRole('status')).toHaveTextContent('Cargando recursos…')
    expect(screen.queryByText('No hay recursos para mostrar')).not.toBeInTheDocument()
    pending.resolve({ status: 'ok', data: [] })
  })

  it('el filtro Mostrar inactivos oculta los inactivos', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Manicure/ })

    await user.click(screen.getByRole('checkbox', { name: 'Mostrar inactivos' }))

    await waitFor(() => expect(screen.queryByRole('row', { name: /Manicure/ })).not.toBeInTheDocument())
    expect(screen.getByRole('row', { name: /Cabina 1/ })).toBeInTheDocument()
  })

  it('sin resources.manage lista pero no ofrece crear, editar ni desactivar', async () => {
    renderWithProviders(<ResourcesPage />, { as: 'lectura' })

    expect(await screen.findByRole('row', { name: /Cabina 1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo recurso' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar|Desactivar|Reactivar/ })).not.toBeInTheDocument()
  })

  it('crea un recurso desde el formulario', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Cabina 1/ })

    await user.click(screen.getByRole('button', { name: 'Nuevo recurso' }))
    await user.type(screen.getByLabelText('Nombre'), 'Cabina 3')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    expect(await screen.findByRole('row', { name: /Cabina 3/ })).toBeInTheDocument()
    expect(getState().resources).toHaveLength(4)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ubica junto al campo Nombre el rechazo de Rust por un nombre repetido y deja abierto el diálogo', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Cabina 1/ })

    await user.click(screen.getByRole('button', { name: 'Nuevo recurso' }))
    await user.type(screen.getByLabelText('Nombre'), 'cabina 1')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveAccessibleDescription('Revisa el dato ingresado'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(getState().resources).toHaveLength(3)
  })

  it('edita un recurso con sus valores precargados', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Cabina 1/ })

    await user.click(screen.getByRole('button', { name: 'Editar Cabina 1' }))
    const nameInput = screen.getByLabelText('Nombre')
    expect(nameInput).toHaveValue('Cabina 1')
    await user.clear(nameInput)
    await user.type(nameInput, 'Cabina Premium')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('row', { name: /Cabina Premium/ })).toBeInTheDocument()
    expect(stateOf(1)?.name).toBe('Cabina Premium')
  })

  it('reactiva un recurso inactivo sin confirmación', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Manicure/ })

    await user.click(screen.getByRole('button', { name: 'Reactivar Manicure (Rosa)' }))

    await waitFor(() => expect(stateOf(3)?.active).toBe(true))
    expect(within(await screen.findByRole('row', { name: /Manicure/ })).getByText('Activo')).toBeInTheDocument()
  })

  it('muestra la alerta cuando falla la reactivación y la limpia al reintentar con éxito', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Manicure/ })
    const original = revokeSessionPermissions()

    await user.click(screen.getByRole('button', { name: 'Reactivar Manicure (Rosa)' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(DENIED_MESSAGE)
    commit(original)
    await user.click(screen.getByRole('button', { name: 'Reactivar Manicure (Rosa)' }))
    await waitFor(() => expect(stateOf(3)?.active).toBe(true))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('desactivar con citas futuras muestra la lista de citas y conserva el recurso activo', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Cabina 1/ })

    await user.click(screen.getByRole('button', { name: 'Desactivar Cabina 1' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('citas futuras')
    expect(await screen.findByText(/Cita #5/)).toBeInTheDocument()
    expect(stateOf(1)?.active).toBe(true)
  })

  it('desactiva un recurso sin citas futuras y cierra el diálogo', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Cabina 1/ })
    installDevIpc({ appointments: createSeed(todayLocal()).appointments.filter((appointment) => appointment.resourceId !== 1) })

    await user.click(screen.getByRole('button', { name: 'Desactivar Cabina 1' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }))

    await waitFor(() => expect(stateOf(1)?.active).toBe(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('el diálogo de recurso tiene descripción accesible y no emite avisos de Radix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await screen.findByRole('row', { name: /Cabina 1/ })

    await user.click(screen.getByRole('button', { name: 'Nuevo recurso' }))

    expect(await screen.findByRole('dialog', { name: 'Nuevo recurso' })).toHaveAccessibleDescription(
      'Define el nombre y el tipo del recurso.',
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

async function failReactivation(user: ReturnType<typeof renderWithProviders>['user']) {
  await screen.findByRole('row', { name: /Manicure/ })
  const original = revokeSessionPermissions()
  await user.click(screen.getByRole('button', { name: 'Reactivar Manicure (Rosa)' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(DENIED_MESSAGE)
  commit(original)
}

describe('ResourcesPage alerta de acción fallida', () => {
  it('desaparece al abrir el diálogo del editor', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await failReactivation(user)

    await user.click(screen.getByRole('button', { name: 'Nuevo recurso' }))

    expect(screen.queryByText(DENIED_MESSAGE)).not.toBeInTheDocument()
  })

  it('desaparece al crear un recurso con éxito', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await failReactivation(user)

    await user.click(screen.getByRole('button', { name: 'Nuevo recurso' }))
    await user.type(screen.getByLabelText('Nombre'), 'Cabina 3')
    await user.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText(DENIED_MESSAGE)).not.toBeInTheDocument()
  })

  it('desaparece al editar un recurso con éxito', async () => {
    const { user } = renderWithProviders(<ResourcesPage />, { as: 'propietaria' })
    await failReactivation(user)

    await user.click(screen.getByRole('button', { name: 'Editar Cabina 1' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText(DENIED_MESSAGE)).not.toBeInTheDocument()
  })
})
