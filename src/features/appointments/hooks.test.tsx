import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import type { AppointmentRange } from '@/lib/model'
import { appErrorOf } from '@/lib/result'
import { appointmentById, storedAppointments } from '@/test/appointment-fixtures'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { renderWithProviders } from '@/test/render'
import { useAppointments, useCreateAppointment, useMoveAppointment, useTransitionAppointment } from './hooks'

const DAY = '2026-11-13'
const RANGE: AppointmentRange = { from: DAY, to: DAY, resourceId: null }

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
})

function AppointmentIds({ range }: { range: AppointmentRange }) {
  const query = useAppointments(range)
  if (query.isError) return <p>{`error:${query.error.message}`}</p>
  return <p>{`citas:${query.data?.map((appointment) => appointment.id).join(',') ?? 'cargando'}`}</p>
}

function Actions() {
  const create = useCreateAppointment()
  const move = useMoveAppointment()
  const transition = useTransitionAppointment()
  return (
    <div>
      <button
        onClick={() =>
          create.mutate({ clientId: 1, serviceId: 1, resourceId: 1, startsAt: `${DAY}T09:00`, notes: null })
        }
      >
        crear
      </button>
      <button onClick={() => move.mutate({ id: 5, move: { startsAt: `${DAY}T12:00`, resourceId: 1 } })}>mover</button>
      <button onClick={() => transition.mutate({ id: 5, transition: 'cancel' })}>cancelar</button>
      <button onClick={() => create.mutate({ clientId: 999, serviceId: 1, resourceId: 1, startsAt: `${DAY}T09:00`, notes: null })}>
        crear-mal
      </button>
      <p>{`error-codigo:${appErrorOf(create.error)?.code ?? 'ninguno'}`}</p>
    </div>
  )
}

describe('useAppointments', () => {
  it('entrega las citas del rango', async () => {
    renderWithProviders(<AppointmentIds range={RANGE} />, { as: 'recepcion' })

    expect(await screen.findByText('citas:5')).toBeInTheDocument()
  })

  it('usa queryKey [appointments, rango]', async () => {
    const { queryClient } = renderWithProviders(<AppointmentIds range={RANGE} />, { as: 'recepcion' })
    await screen.findByText('citas:5')

    expect(queryClient.getQueryData(['appointments', RANGE])).toHaveLength(1)
  })

  it('sin sesión expone el error de dominio', async () => {
    renderWithProviders(<AppointmentIds range={RANGE} />)

    expect(await screen.findByText('error:Inicia sesión para continuar')).toBeInTheDocument()
  })
})

describe('mutaciones de citas', () => {
  it('crear agrega la cita al store e invalida appointments, clientHistory, metrics y payments', async () => {
    const { queryClient, user } = renderWithProviders(<Actions />, { as: 'recepcion' })
    await queryClient.prefetchQuery({ queryKey: ['appointments', RANGE], queryFn: () => [] })
    await queryClient.prefetchQuery({ queryKey: ['clientHistory', 1], queryFn: () => null })
    await queryClient.prefetchQuery({ queryKey: ['metrics', '2026-11'], queryFn: () => null })
    await queryClient.prefetchQuery({ queryKey: ['payments', 5], queryFn: () => [] })
    await queryClient.prefetchQuery({ queryKey: ['clients', {}], queryFn: () => [] })

    await user.click(screen.getByRole('button', { name: 'crear' }))

    await waitFor(async () => expect(await storedAppointments()).toHaveLength(17))
    await waitFor(() => {
      expect(queryClient.getQueryState(['appointments', RANGE])?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(['clientHistory', 1])?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(['metrics', '2026-11'])?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(['payments', 5])?.isInvalidated).toBe(true)
    })
    expect(queryClient.getQueryState(['clients', {}])?.isInvalidated).toBe(false)
  })

  it('crear con error de dominio lo expone como AppError', async () => {
    const { user } = renderWithProviders(<Actions />, { as: 'recepcion' })

    await user.click(screen.getByRole('button', { name: 'crear-mal' }))

    expect(await screen.findByText('error-codigo:notFound')).toBeInTheDocument()
  })

  it('mover actualiza la cita', async () => {
    const { user } = renderWithProviders(<Actions />, { as: 'recepcion' })

    await user.click(screen.getByRole('button', { name: 'mover' }))

    await waitFor(async () => expect((await appointmentById(5)).startsAt).toBe(`${DAY}T12:00`))
  })

  it('transicionar cancel cambia el estado', async () => {
    const { user } = renderWithProviders(<Actions />, { as: 'recepcion' })

    await user.click(screen.getByRole('button', { name: 'cancelar' }))

    await waitFor(async () => expect((await appointmentById(5)).status).toBe('cancelled'))
  })
})
