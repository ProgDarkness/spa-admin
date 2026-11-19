import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

function renderSelect(props: { onValueChange?: (value: string) => void; disabled?: boolean } = {}) {
  return render(
    <Select {...props}>
      <SelectTrigger aria-label="Recurso" className="extra">
        <SelectValue placeholder="Elegir" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Sala A</SelectItem>
        <SelectItem value="b">Sala B</SelectItem>
      </SelectContent>
    </Select>,
  )
}

describe('Select', () => {
  it('el trigger es un combobox accesible cerrado con placeholder y clases de token', () => {
    renderSelect()

    const trigger = screen.getByRole('combobox', { name: 'Recurso' })
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('Elegir')
    expect(trigger).toHaveClass('border', 'border-input', 'focus-visible:ring-ring', 'extra')
    expect(trigger).toHaveAttribute('data-size', 'default')
  })

  it('abre la lista y expone las opciones con estilo de popover', async () => {
    renderSelect()

    await userEvent.click(screen.getByRole('combobox', { name: 'Recurso' }))

    expect(screen.getByRole('combobox', { name: 'Recurso', hidden: true })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Sala A', 'Sala B'])
    const content = document.querySelector('[data-slot="select-content"]')
    expect(content).toHaveClass('bg-popover', 'border-border', 'text-popover-foreground')
  })

  it('selecciona una opcion, notifica el valor y cierra', async () => {
    const onValueChange = vi.fn()
    renderSelect({ onValueChange })

    await userEvent.click(screen.getByRole('combobox', { name: 'Recurso' }))
    await userEvent.click(screen.getByRole('option', { name: 'Sala B' }))

    expect(onValueChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Recurso' })).toHaveTextContent('Sala B')
  })

  it('disabled impide abrir la lista', async () => {
    renderSelect({ disabled: true })

    const trigger = screen.getByRole('combobox', { name: 'Recurso' })
    await userEvent.click(trigger)

    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})
