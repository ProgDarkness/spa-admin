import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Resource } from '@/lib/model'
import { ResourceTable } from './resource-table'

const RESOURCES: Resource[] = [
  { id: 1, name: 'Cabina 1', kind: 'cabin', active: true },
  { id: 3, name: 'Manicure (Rosa)', kind: 'manicure', active: false },
]

function renderTable(canManage: boolean) {
  const onEdit = vi.fn()
  const onToggleActive = vi.fn()
  const user = userEvent.setup()
  render(<ResourceTable resources={RESOURCES} canManage={canManage} onEdit={onEdit} onToggleActive={onToggleActive} />)
  return { onEdit, onToggleActive, user }
}

describe('ResourceTable', () => {
  it('muestra nombre, tipo y estado de cada recurso', () => {
    renderTable(false)

    const cabinRow = screen.getByRole('row', { name: /Cabina 1/ })
    expect(within(cabinRow).getByText('Cabina')).toBeInTheDocument()
    expect(within(cabinRow).getByText('Activo')).toBeInTheDocument()
    const manicureRow = screen.getByRole('row', { name: /Manicure \(Rosa\)/ })
    expect(within(manicureRow).getByText('Manicure')).toBeInTheDocument()
    expect(within(manicureRow).getByText('Inactivo')).toBeInTheDocument()
  })

  it('tiene un nombre accesible', () => {
    renderTable(false)

    expect(screen.getByRole('table', { name: 'Recursos agendables' })).toBeInTheDocument()
  })

  it('sin permiso de gestión no muestra acciones ni columna', () => {
    renderTable(false)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument()
  })

  it('con permiso ofrece Editar y Desactivar o Reactivar según el estado', () => {
    renderTable(true)

    expect(screen.getByRole('button', { name: 'Editar Cabina 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar Cabina 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactivar Manicure (Rosa)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactivar Cabina 1' })).not.toBeInTheDocument()
  })

  it('emite el recurso correcto al editar y alternar', async () => {
    const { onEdit, onToggleActive, user } = renderTable(true)

    await user.click(screen.getByRole('button', { name: 'Editar Cabina 1' }))
    await user.click(screen.getByRole('button', { name: 'Reactivar Manicure (Rosa)' }))

    expect(onEdit).toHaveBeenCalledWith(RESOURCES[0])
    expect(onToggleActive).toHaveBeenCalledWith(RESOURCES[1])
  })

  it('muestra un mensaje cuando no hay recursos', () => {
    render(<ResourceTable resources={[]} canManage onEdit={vi.fn()} onToggleActive={vi.fn()} />)

    expect(screen.getByText('No hay recursos para mostrar').closest('[data-slot="empty-state"]')).not.toBeNull()
  })

  it('agrupa los botones de acción en row-actions dentro de una celda normal', () => {
    renderTable(true)

    const edit = screen.getByRole('button', { name: 'Editar Cabina 1' })
    const cell = edit.closest('td') as HTMLElement
    const actions = edit.closest('[data-slot="row-actions"]') as HTMLElement
    expect(actions).not.toBeNull()
    expect(actions).not.toBe(cell)
    expect(cell).toContainElement(actions)
    expect(cell).not.toHaveAttribute('data-slot', 'row-actions')
  })
})
