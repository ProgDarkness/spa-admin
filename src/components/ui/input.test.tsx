import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Input } from './input'

describe('Input', () => {
  it('renderiza un textbox con data-slot, altura h-9 y borde de token', () => {
    render(<Input aria-label="Nombre" />)

    const input = screen.getByRole('textbox', { name: 'Nombre' })
    expect(input).toHaveAttribute('data-slot', 'input')
    expect(input).toHaveClass('h-9', 'border', 'border-input', 'w-full')
  })

  it('define el anillo de foco con el token ring', () => {
    render(<Input aria-label="Nombre" />)

    expect(screen.getByRole('textbox')).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring')
  })

  it('pasa type, placeholder y className', () => {
    render(<Input aria-label="Correo" type="email" placeholder="a@b.co" className="extra" />)

    const input = screen.getByLabelText('Correo')
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('placeholder', 'a@b.co')
    expect(input).toHaveClass('extra', 'h-9')
  })

  it('propaga onChange al escribir', async () => {
    const onChange = vi.fn()
    render(<Input aria-label="Nombre" onChange={onChange} />)

    await userEvent.type(screen.getByRole('textbox'), 'ab')

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('textbox')).toHaveValue('ab')
  })

  it('disabled bloquea la escritura y aplica estilo atenuado', async () => {
    const onChange = vi.fn()
    render(<Input aria-label="Nombre" disabled onChange={onChange} />)

    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'ab')

    expect(input).toBeDisabled()
    expect(input).toHaveValue('')
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed')
  })

  it('aria-invalid usa tokens destructive', () => {
    render(<Input aria-label="Nombre" aria-invalid="true" />)

    expect(screen.getByRole('textbox')).toHaveClass('aria-invalid:border-destructive')
  })
})
