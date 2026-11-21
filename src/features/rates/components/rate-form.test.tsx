import { mockIPC } from '@tauri-apps/api/mocks'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import type { AppError } from '@/lib/model'
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

  describe('vista previa de la tasa', () => {
    const RATE_LABEL = 'Tasa (Bs por USD)'

    it.each([
      ['3,650', 'Se guardará como 3,6500 Bs por USD'],
      ['36,5', 'Se guardará como 36,5000 Bs por USD'],
      ['36.5', 'Se guardará como 36,5000 Bs por USD'],
      ['36,1234', 'Se guardará como 36,1234 Bs por USD'],
    ])('el texto %j muestra la vista previa %j', async (text, preview) => {
      const { user } = renderWithProviders(<RateForm />, { as: 'recepcion' })

      await user.type(screen.getByLabelText(RATE_LABEL), text)

      expect(screen.getByText(preview)).toBeInTheDocument()
    })

    it('asocia la vista previa al campo con aria-describedby', async () => {
      const { user } = renderWithProviders(<RateForm />, { as: 'recepcion' })

      await user.type(screen.getByLabelText(RATE_LABEL), '3,650')

      const describedBy = screen.getByLabelText(RATE_LABEL).getAttribute('aria-describedby') ?? ''
      const preview = screen.getByText('Se guardará como 3,6500 Bs por USD')
      expect(describedBy.split(' ')).toContain(preview.id)
      expect(screen.getByLabelText(RATE_LABEL)).toHaveAccessibleDescription('Se guardará como 3,6500 Bs por USD')
    })

    it.each(['', 'abc', '36.12345', '0', '-1', '36,'])('el texto %j no muestra la vista previa', async (text) => {
      const { user } = renderWithProviders(<RateForm />, { as: 'recepcion' })

      if (text) await user.type(screen.getByLabelText(RATE_LABEL), text)

      expect(screen.queryByText(/Se guardará como/)).not.toBeInTheDocument()
    })

    it('retira la vista previa cuando el texto deja de ser válido', async () => {
      const { user } = renderWithProviders(<RateForm />, { as: 'recepcion' })
      const input = screen.getByLabelText(RATE_LABEL)

      await user.type(input, '36,5')
      expect(screen.getByText('Se guardará como 36,5000 Bs por USD')).toBeInTheDocument()
      await user.type(input, 'x')

      expect(screen.queryByText(/Se guardará como/)).not.toBeInTheDocument()
    })
  })

  describe('errores de validación del backend', () => {
    const DATE_LABEL = 'Fecha'
    const RATE_LABEL = 'Tasa (Bs por USD)'

    function rejectUpsertWith(error: AppError): void {
      mockIPC((cmd) => {
        if (cmd === 'upsert_rate') throw error
        return null
      })
    }

    function failure(code: AppError['code'], field: string | null, message: string): AppError {
      return { code, message, field, entityIds: null }
    }

    async function submitRate() {
      const rendered = renderWithProviders(<RateForm />, { as: 'recepcion' })
      await rendered.user.type(screen.getByLabelText(RATE_LABEL), '36,50')
      await rendered.user.click(screen.getByRole('button', { name: 'Guardar tasa' }))
      return rendered
    }

    it.each([
      ['date', DATE_LABEL],
      ['rateBsPerUsdE4', RATE_LABEL],
    ] as const)('ubica validation del campo %s junto a su control y no como alerta', async (field, label) => {
      const message = `Copy del backend para ${field}`
      rejectUpsertWith(failure('validation', field, message))

      await submitRate()

      await waitFor(() => expect(screen.getByLabelText(label)).toHaveAccessibleDescription(expect.stringContaining(message)))
      expect(screen.getByLabelText(label)).toBeInvalid()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('no marca el otro campo cuando el error es de un solo campo', async () => {
      rejectUpsertWith(failure('validation', 'date', 'Fecha rechazada'))

      await submitRate()

      await waitFor(() => expect(screen.getByLabelText(DATE_LABEL)).toBeInvalid())
      expect(screen.getByLabelText(RATE_LABEL)).toBeValid()
    })

    it.each(['id', 'name', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
      'muestra como alerta un validation con field %s que no es del formulario',
      async (field) => {
        rejectUpsertWith(failure('validation', field, 'Revisa el dato ingresado'))

        await submitRate()

        expect(await screen.findByRole('alert')).toHaveTextContent('Revisa el dato ingresado')
        expect(screen.getByLabelText(DATE_LABEL)).toBeValid()
        expect(screen.getByLabelText(RATE_LABEL)).toBeValid()
      },
    )

    it('muestra como alerta un validation sin campo', async () => {
      rejectUpsertWith(failure('validation', null, 'Revisa el dato ingresado'))

      await submitRate()

      expect(await screen.findByRole('alert')).toHaveTextContent('Revisa el dato ingresado')
    })

    it('muestra como alerta un error que no es de validación aunque traiga field date', async () => {
      rejectUpsertWith(failure('forbidden', 'date', 'No tienes permiso para esta acción'))

      await submitRate()

      expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
      expect(screen.getByLabelText(DATE_LABEL)).toBeValid()
    })
  })
})
