import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import RatesPage from './page'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('RatesPage', () => {
  it('muestra el título, la tabla y el formulario a quien administra tasas', async () => {
    renderWithProviders(<RatesPage />, { as: 'recepcion' })

    expect(screen.getByRole('heading', { level: 1, name: 'Tasas de cambio' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Tasas de cambio' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Tasa (Bs por USD)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar tasa' })).toBeInTheDocument()
  })

  it('oculta el formulario a quien solo puede leer', async () => {
    renderWithProviders(<RatesPage />, { as: 'lectura' })

    expect(await screen.findByRole('table', { name: 'Tasas de cambio' })).toBeInTheDocument()
    await screen.findByText('Solo lectura: no tienes permiso para modificar las tasas.')
    expect(screen.queryByLabelText('Tasa (Bs por USD)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar tasa' })).not.toBeInTheDocument()
  })

  it('refresca la tabla tras guardar una tasa nueva', async () => {
    const { user } = renderWithProviders(<RatesPage />, { as: 'recepcion' })
    await screen.findByRole('table', { name: 'Tasas de cambio' })
    await screen.findByLabelText('Tasa (Bs por USD)')

    await user.clear(screen.getByLabelText('Fecha'))
    await user.type(screen.getByLabelText('Fecha'), '2026-12-01')
    await user.type(screen.getByLabelText('Tasa (Bs por USD)'), '38')
    await user.click(screen.getByRole('button', { name: 'Guardar tasa' }))

    expect(await screen.findByText('2026-12-01')).toBeInTheDocument()
    expect(getState().rates).toHaveLength(8)
  })

  it('muestra el error cuando no hay permiso de lectura', async () => {
    renderWithProviders(<RatesPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Debes iniciar sesión')
  })
})
