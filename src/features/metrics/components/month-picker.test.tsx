import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MonthPicker } from './month-picker'

describe('MonthPicker', () => {
  it('muestra el mes con una etiqueta accesible', () => {
    render(<MonthPicker month="2026-11" onChange={vi.fn()} />)

    expect(screen.getByLabelText('Mes')).toHaveValue('2026-11')
    expect(screen.getByLabelText('Mes')).toHaveAttribute('type', 'month')
  })

  it('el botón anterior retrocede un mes cruzando el año', async () => {
    const onChange = vi.fn()
    render(<MonthPicker month="2026-01" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))

    expect(onChange).toHaveBeenCalledWith('2025-12')
  })

  it('el botón siguiente avanza un mes cruzando el año', async () => {
    const onChange = vi.fn()
    render(<MonthPicker month="2026-12" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }))

    expect(onChange).toHaveBeenCalledWith('2027-01')
  })

  it('emite el mes elegido en el input', () => {
    const onChange = vi.fn()
    render(<MonthPicker month="2026-11" onChange={onChange} />)

    fireInput(screen.getByLabelText('Mes'), '2026-03')

    expect(onChange).toHaveBeenCalledWith('2026-03')
  })

  it('ignora el vaciado del input', () => {
    const onChange = vi.fn()
    render(<MonthPicker month="2026-11" onChange={onChange} />)

    fireInput(screen.getByLabelText('Mes'), '')

    expect(onChange).not.toHaveBeenCalled()
  })
})

function fireInput(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } })
}
