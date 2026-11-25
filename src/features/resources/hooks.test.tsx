import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { ResourceListFilter } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import {
  useCreateResource,
  useFutureAppointmentsOfResource,
  useResources,
  useSetResourceActive,
  useUpdateResource,
} from './hooks'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function ResourceNames({ filter }: { filter: ResourceListFilter }) {
  const query = useResources(filter)
  if (query.isError) return <p>{`error:${query.error.message}`}</p>
  return <p>{`recursos:${query.data?.map((resource) => resource.name).join('|') ?? 'cargando'}`}</p>
}

function FutureIds({ id }: { id: number | null }) {
  const query = useFutureAppointmentsOfResource(id)
  return <p>{`futuras:${query.data?.map((appointment) => appointment.id).join(',') ?? 'ninguna'}`}</p>
}

describe('useResources', () => {
  it('entrega los recursos activos con includeInactive false', async () => {
    renderWithProviders(<ResourceNames filter={{ includeInactive: false }} />, { as: 'propietaria' })

    expect(await screen.findByText('recursos:Cabina 1|Cabina 2')).toBeInTheDocument()
  })

  it('entrega también los inactivos con includeInactive true', async () => {
    renderWithProviders(<ResourceNames filter={{ includeInactive: true }} />, { as: 'propietaria' })

    expect(await screen.findByText('recursos:Cabina 1|Cabina 2|Manicure (Rosa)')).toBeInTheDocument()
  })

  it('usa queryKey [resources, filtro]', async () => {
    const filter = { includeInactive: true }
    const { queryClient } = renderWithProviders(<ResourceNames filter={filter} />, { as: 'propietaria' })
    await screen.findByText(/^recursos:Cabina/)

    expect(queryClient.getQueryData(['resources', filter])).toHaveLength(3)
  })

  it('convierte un error de dominio en error de la consulta', async () => {
    renderWithProviders(<ResourceNames filter={{ includeInactive: true }} />)

    expect(await screen.findByText('error:Inicia sesión para continuar')).toBeInTheDocument()
  })
})

describe('useFutureAppointmentsOfResource', () => {
  it('no consulta con id null', async () => {
    const { queryClient } = renderWithProviders(<FutureIds id={null} />, { as: 'propietaria' })

    expect(screen.getByText('futuras:ninguna')).toBeInTheDocument()
    expect(queryClient.isFetching()).toBe(0)
  })

  it('entrega las citas scheduled futuras del recurso', async () => {
    renderWithProviders(<FutureIds id={1} />, { as: 'propietaria' })

    expect(await screen.findByText('futuras:5')).toBeInTheDocument()
  })
})

describe('mutaciones', () => {
  function Probe() {
    const create = useCreateResource()
    const update = useUpdateResource()
    const setActive = useSetResourceActive()
    return (
      <>
        <button onClick={() => create.mutate({ name: 'Nueva', kind: 'cabin' })}>crear</button>
        <button onClick={() => update.mutate({ id: 1, input: { name: 'Renombrada', kind: 'cabin' } })}>editar</button>
        <button onClick={() => setActive.mutate({ id: 3, active: true })}>reactivar</button>
        <button onClick={() => setActive.mutate({ id: 1, active: false })}>desactivar</button>
        <p>{`activaError:${setActive.error?.message ?? 'ninguno'}`}</p>
      </>
    )
  }

  it.each(['crear', 'editar', 'reactivar'])('%s invalida resources y appointments', async (label) => {
    const { queryClient, user } = renderWithProviders(<Probe />, { as: 'propietaria' })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['resources'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['appointments'] })
  })

  it('persiste el cambio en el store', async () => {
    const { user } = renderWithProviders(<Probe />, { as: 'propietaria' })

    await user.click(screen.getByRole('button', { name: 'crear' }))

    await waitFor(() => expect(getState().resources).toHaveLength(4))
  })

  it('un rechazo de dominio llega como error y no invalida', async () => {
    const { queryClient, user } = renderWithProviders(<Probe />, { as: 'propietaria' })
    commit({ ...getState() })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'desactivar' }))

    expect(
      await screen.findByText(
        'activaError:El recurso tiene citas futuras que deben reubicarse antes de desactivarlo',
      ),
    ).toBeInTheDocument()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
