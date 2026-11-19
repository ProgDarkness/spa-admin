import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { setSearchParams } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import ClientRecordPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('ClientRecordPage', () => {
  it('muestra la ficha del cliente indicado en ?id', async () => {
    setSearchParams({ id: '1' })
    renderWithProviders(<ClientRecordPage />, { as: 'recepcion' })

    expect(await screen.findByRole('heading', { level: 1, name: 'María González' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Historial de citas' })).toBeInTheDocument()
  })

  it('la ficha muestra el botón de pagos que abre el diálogo', async () => {
    setSearchParams({ id: '1' })
    const { user } = renderWithProviders(<ClientRecordPage />, { as: 'recepcion' })

    const items = within(await screen.findByRole('list', { name: 'Historial de citas' })).getAllByRole('listitem')
    await user.click(within(items[0]!).getByRole('button', { name: 'Pagos' }))

    expect(await screen.findByRole('dialog', { name: 'Pagos de la cita' })).toBeInTheDocument()
  })

  it('un id inexistente muestra Cliente no encontrado con enlace a /clientes', async () => {
    setSearchParams({ id: '9999' })
    renderWithProviders(<ClientRecordPage />, { as: 'recepcion' })

    expect(await screen.findByText('Cliente no encontrado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a clientes' })).toHaveAttribute('href', '/clientes')
  })

  it.each(['abc', '', '1.5', '-1', '0', '1e3'])('un id inválido (%j) muestra el estado vacío', async (id) => {
    setSearchParams({ id })
    renderWithProviders(<ClientRecordPage />, { as: 'recepcion' })

    expect(await screen.findByText('Cliente no encontrado')).toBeInTheDocument()
  })

  it('sin parámetro id muestra el estado vacío', async () => {
    setSearchParams({})
    renderWithProviders(<ClientRecordPage />, { as: 'recepcion' })

    expect(await screen.findByText('Cliente no encontrado')).toBeInTheDocument()
  })
})
