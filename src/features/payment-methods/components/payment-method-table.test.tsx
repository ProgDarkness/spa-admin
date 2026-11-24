import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PaymentMethod } from '@/lib/model'
import { PaymentMethodTable } from './payment-method-table'

const METHODS: PaymentMethod[] = [
  { id: 1, name: 'Efectivo', active: true },
  { id: 3, name: 'Zelle', active: false },
]

function renderTable(canManage: boolean) {
  const onEdit = vi.fn()
  const onToggleActive = vi.fn()
  const user = userEvent.setup()
  render(
    <PaymentMethodTable paymentMethods={METHODS} canManage={canManage} onEdit={onEdit} onToggleActive={onToggleActive} />,
  )
  return { onEdit, onToggleActive, user }
}

describe('PaymentMethodTable', () => {
  it('muestra nombre y estado de cada método', () => {
    renderTable(false)

    expect(within(screen.getByRole('row', { name: /Efectivo/ })).getByText('Activo')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Zelle/ })).getByText('Inactivo')).toBeInTheDocument()
  })

  it('tiene un nombre accesible', () => {
    renderTable(false)

    expect(screen.getByRole('table', { name: 'Métodos de pago' })).toBeInTheDocument()
  })

  it('sin permiso de gestión no muestra acciones ni columna', () => {
    renderTable(false)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument()
  })

  it('con permiso ofrece Editar y Desactivar o Reactivar según el estado', () => {
    renderTable(true)

    expect(screen.getByRole('button', { name: 'Editar Efectivo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar Efectivo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactivar Zelle' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactivar Efectivo' })).not.toBeInTheDocument()
  })

  it('emite el método correcto al editar y alternar', async () => {
    const { onEdit, onToggleActive, user } = renderTable(true)

    await user.click(screen.getByRole('button', { name: 'Editar Efectivo' }))
    await user.click(screen.getByRole('button', { name: 'Reactivar Zelle' }))

    expect(onEdit).toHaveBeenCalledWith(METHODS[0])
    expect(onToggleActive).toHaveBeenCalledWith(METHODS[1])
  })

  it('muestra un mensaje cuando no hay métodos', () => {
    render(<PaymentMethodTable paymentMethods={[]} canManage onEdit={vi.fn()} onToggleActive={vi.fn()} />)

    expect(screen.getByText('No hay métodos de pago para mostrar').closest('[data-slot="empty-state"]')).not.toBeNull()
  })

  it('agrupa los botones de acción en row-actions dentro de una celda normal', () => {
    renderTable(true)

    const edit = screen.getByRole('button', { name: 'Editar Efectivo' })
    const cell = edit.closest('td') as HTMLElement
    const actions = edit.closest('[data-slot="row-actions"]') as HTMLElement
    expect(actions).not.toBeNull()
    expect(cell).toContainElement(actions)
    expect(cell).not.toHaveAttribute('data-slot', 'row-actions')
  })
})
