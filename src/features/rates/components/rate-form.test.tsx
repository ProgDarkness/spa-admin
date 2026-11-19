import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { RateForm } from './rate-form'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('RateForm', () => {
  it('propone la fecha de hoy y deja la tasa vacía', () => {
    renderWithProviders(<RateForm />, { as: 'recepcion' })

    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-12')
    expect(screen.getByLabelText('Tasa (Bs por USD)')).toHaveValue('')
  })

  it('guarda 36,50 como 365000 reemplazando la tasa de esa fecha', async () => {
    const { user } = renderWithProviders(<RateForm />, { as: 'recepcion' })

    await user.type(screen.getByLabelText('Tasa (Bs por USD)'), '37,25')
    await user.click(screen.getByRole('button', { name: 'Guardar tasa' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Tasa guardada')
    expect(getState().rates).toHaveLength(7)
    expect(getState().rates.find((rate) => rate.date === '2026-11-12')?.rateBsPerUsdE4).toBe(372500)
  })

  it('muestra el error de validación y no guarda más de 4 decimales', async () => {
    const { user } = renderWithProviders(<RateForm />, { as: 'recepcion' })
    const before = getState().rates

    await user.type(screen.getByLabelText('Tasa (Bs por USD)'), '36.12345')
    await user.click(screen.getByRole('button', { name: 'Guardar tasa' }))

    expect(await screen.findByText('Ingresa una tasa mayor que cero con hasta 4 decimales')).toBeInTheDocument()
    expect(getState().rates).toBe(before)
  })

  it('muestra el error de dominio cuando el usuario no puede editar', async () => {
    const { user } = renderWithProviders(<RateForm />, { as: 'lectura' })

    await user.type(screen.getByLabelText('Tasa (Bs por USD)'), '36,50')
    await user.click(screen.getByRole('button', { name: 'Guardar tasa' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})
