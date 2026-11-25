import { screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { login } from '@/features/auth/api'
import { EMPTY_STATE, commit } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { setSearchParams } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import { installRustLikeBackend } from '@/test/rust-like-backend'
import AppointmentsPage from './(app)/citas/page'
import CatalogPage from './(app)/catalogo/page'
import ClientsPage from './(app)/clientes/page'
import ClientRecordPage from './(app)/clientes/ficha/page'
import MetricsPage from './(app)/metricas/page'
import PaymentMethodsPage from './(app)/ajustes/metodos-pago/page'
import ResourcesPage from './(app)/ajustes/recursos/page'
import RatesPage from './(app)/ajustes/tasas/page'

type ScreenCase = { name: string; heading: string; element: () => ReactElement }

const SCREENS: readonly ScreenCase[] = [
  { name: 'clientes', heading: 'Clientes', element: () => <ClientsPage /> },
  { name: 'agenda', heading: 'Agenda', element: () => <AppointmentsPage /> },
  { name: 'catálogo', heading: 'Catálogo', element: () => <CatalogPage /> },
  { name: 'recursos', heading: 'Recursos', element: () => <ResourcesPage /> },
  { name: 'métodos de pago', heading: 'Métodos de pago', element: () => <PaymentMethodsPage /> },
  { name: 'tasas', heading: 'Tasas de cambio', element: () => <RatesPage /> },
  { name: 'métricas', heading: 'Métricas', element: () => <MetricsPage /> },
]

const EMPTY_RUST_DATA = {
  clients: [],
  services: [],
  resources: [],
  paymentMethods: [],
  rates: [],
  appointments: [],
  payments: [],
} as const

async function signInThroughRust(): Promise<void> {
  const result = await login('propietaria', DEV_PASSWORD)
  expect(result.status).toBe('ok')
  commit(EMPTY_STATE)
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  commit(EMPTY_STATE)
})

describe.each(SCREENS)('pantalla $name con el store vacío', ({ heading, element }) => {
  it('se monta con la sesión de Rust y sin datos sembrados en el store', async () => {
    installRustLikeBackend()
    await signInThroughRust()

    renderWithProviders(element())

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/^Cargando/)).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('con Rust sin datos muestra la pantalla sin errores', async () => {
    installRustLikeBackend({ dataOverrides: EMPTY_RUST_DATA })
    await signInThroughRust()

    renderWithProviders(element())

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/^Cargando/)).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('datos hidratados desde Rust con el store vacío', () => {
  it('clientes lista los clientes de Rust', async () => {
    installRustLikeBackend()
    await signInThroughRust()

    renderWithProviders(<ClientsPage />)

    expect(await screen.findByRole('link', { name: 'María González' })).toBeInTheDocument()
  })

  it('catálogo, recursos y métodos de pago listan lo de Rust', async () => {
    installRustLikeBackend()
    await signInThroughRust()

    renderWithProviders(<ResourcesPage />)

    expect(await screen.findByRole('row', { name: /Cabina 2/ })).toBeInTheDocument()
  })

  it('métricas calcula sobre lo hidratado desde Rust', async () => {
    installRustLikeBackend()
    await signInThroughRust()

    renderWithProviders(<MetricsPage />)

    expect(await screen.findByText('Clientes nuevos')).toBeInTheDocument()
  })
})

describe('ficha de cliente, historial y pagos con el store vacío', () => {
  it('muestra el historial hidratado desde Rust', async () => {
    installRustLikeBackend()
    await signInThroughRust()
    setSearchParams({ id: '1' })

    renderWithProviders(<ClientRecordPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'María González' })).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: 'Historial de citas' })).toBeInTheDocument()
  })

  it('el diálogo de pagos de la cita abre sin datos sembrados en el store', async () => {
    installRustLikeBackend()
    await signInThroughRust()
    setSearchParams({ id: '1' })

    const { user } = renderWithProviders(<ClientRecordPage />)
    const items = within(await screen.findByRole('list', { name: 'Historial de citas' })).getAllByRole('listitem')
    await user.click(within(items[0]!).getByRole('button', { name: 'Pagos' }))

    expect(await screen.findByRole('dialog', { name: 'Pagos de la cita' })).toBeInTheDocument()
  })

  it('un cliente inexistente en Rust muestra Cliente no encontrado', async () => {
    installRustLikeBackend({ dataOverrides: EMPTY_RUST_DATA })
    await signInThroughRust()
    setSearchParams({ id: '1' })

    renderWithProviders(<ClientRecordPage />)

    expect(await screen.findByText('Cliente no encontrado')).toBeInTheDocument()
  })
})
