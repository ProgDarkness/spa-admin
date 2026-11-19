import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NativeSelect } from './native-select'

describe('NativeSelect', () => {
  it('renderiza un select nativo con sus opciones y valor controlado', () => {
    render(
      <NativeSelect aria-label="Recurso" defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>,
    )

    expect(screen.getByRole('combobox', { name: 'Recurso' })).toHaveValue('b')
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('se identifica con data-slot y respeta el className recibido', () => {
    render(<NativeSelect aria-label="Recurso" className="extra-clase" />)

    const select = screen.getByRole('combobox', { name: 'Recurso' })
    expect(select).toHaveAttribute('data-slot', 'native-select')
    expect(select).toHaveClass('extra-clase')
  })

  it('propaga onChange y disabled', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <NativeSelect aria-label="Recurso" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>,
    )

    await userEvent.selectOptions(screen.getByRole('combobox'), 'b')
    expect(onChange).toHaveBeenCalledTimes(1)

    rerender(<NativeSelect aria-label="Recurso" disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
