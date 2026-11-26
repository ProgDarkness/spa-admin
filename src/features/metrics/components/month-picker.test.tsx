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

  it('en el primer mes soportado el botón anterior está deshabilitado y no emite', async () => {
    const onChange = vi.fn()
    render(<MonthPicker month="0001-01" onChange={onChange} />)

    const previous = screen.getByRole('button', { name: 'Mes anterior' })
    await userEvent.click(previous)

    expect(previous).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeEnabled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('en el último mes soportado el botón siguiente está deshabilitado y no emite', async () => {
    const onChange = vi.fn()
    render(<MonthPicker month="9998-12" onChange={onChange} />)

    const next = screen.getByRole('button', { name: 'Mes siguiente' })
    await userEvent.click(next)

    expect(next).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeEnabled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('los botones llegan a los extremos desde el mes vecino', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<MonthPicker month="0001-02" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))
    rerender(<MonthPicker month="9998-11" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }))

    expect(onChange.mock.calls).toEqual([['0001-01'], ['9998-12']])
  })

  it('el input declara las cotas min y max', () => {
    render(<MonthPicker month="2026-11" onChange={vi.fn()} />)

    expect(screen.getByLabelText('Mes')).toHaveAttribute('min', '0001-01')
    expect(screen.getByLabelText('Mes')).toHaveAttribute('max', '9998-12')
  })

  it.each(['0000-05', '9999-01', '10000-01', '12026-01', 'abcd-ef', '2026-13'])('ignora el mes fuera de rango %s del input', (value) => {
    const onChange = vi.fn()
    render(<MonthPicker month="2026-11" onChange={onChange} />)

    fireInput(screen.getByLabelText('Mes'), value)

    expect(onChange).not.toHaveBeenCalled()
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
