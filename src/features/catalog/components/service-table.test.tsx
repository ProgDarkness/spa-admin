import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatCents } from '@/lib/money'
import type { Service } from '@/lib/model'
import { ServiceTable } from './service-table'

const activeService: Service = { id: 1, name: 'Limpieza facial', priceCents: 3_500, currency: 'USD', durationMin: 60, active: true }
const inactiveService: Service = { id: 2, name: 'Peeling', priceCents: 5_000, currency: 'USD', durationMin: 45, active: false }
const bundle: Service = { id: 3, name: 'Paquete 4 limpiezas', priceCents: 12_000, currency: 'USD', durationMin: 60, active: true }

function renderTable(overrides: Partial<Parameters<typeof ServiceTable>[0]> = {}) {
  const onEdit = vi.fn()
  const onToggleActive = vi.fn()
  render(
    <ServiceTable
      services={[activeService, inactiveService, bundle]}
      canWrite
      onEdit={onEdit}
      onToggleActive={onToggleActive}
      {...overrides}
    />,
  )
  return { onEdit, onToggleActive }
}

describe('ServiceTable', () => {
  it('muestra nombre, precio USD formateado, duración y estado por fila', () => {
    renderTable()

    const row = screen.getByRole('row', { name: /Limpieza facial/ })
    expect(within(row).getByText(formatCents(3_500, 'USD').replace(/\s/g, ' '))).toBeInTheDocument()
    expect(within(row).getByText('60 min')).toBeInTheDocument()
    expect(within(row).getByText('Activo')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Peeling/ })).getByText('Inactivo')).toBeInTheDocument()
  })

  it('tiene columnas con encabezados accesibles', () => {
    renderTable()

    ;['Servicio', 'Precio', 'Duración', 'Estado'].forEach((name) => {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    })
  })

  it('con canWrite muestra Editar y Desactivar/Reactivar según el estado', () => {
    renderTable()

    expect(screen.getByRole('button', { name: 'Editar Limpieza facial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar Limpieza facial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactivar Peeling' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desactivar Peeling' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Acciones' })).toBeInTheDocument()
  })

  it('sin canWrite oculta toda acción y la columna Acciones', () => {
    renderTable({ canWrite: false })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument()
  })

  it('emite onEdit y onToggleActive con el servicio de la fila', async () => {
    const user = userEvent.setup()
    const { onEdit, onToggleActive } = renderTable()

    await user.click(screen.getByRole('button', { name: 'Editar Limpieza facial' }))
    await user.click(screen.getByRole('button', { name: 'Reactivar Peeling' }))

    expect(onEdit).toHaveBeenCalledWith(activeService)
    expect(onToggleActive).toHaveBeenCalledWith(inactiveService)
  })

  it('distingue el paquete solo por su nombre', () => {
    renderTable()

    expect(screen.getByRole('row', { name: /Paquete 4 limpiezas/ })).toBeInTheDocument()
  })

  it('muestra un estado vacío sin servicios', () => {
    renderTable({ services: [] })

    expect(screen.getByText('No hay servicios registrados').closest('[data-slot="empty-state"]')).not.toBeNull()
  })

  it('agrupa los botones de acción en row-actions dentro de una celda normal', () => {
    renderTable()

    const edit = screen.getByRole('button', { name: 'Editar Limpieza facial' })
    const cell = edit.closest('td') as HTMLElement
    const actions = edit.closest('[data-slot="row-actions"]') as HTMLElement
    expect(actions).not.toBeNull()
    expect(actions).not.toBe(cell)
    expect(cell).toContainElement(actions)
    expect(cell).not.toHaveAttribute('data-slot', 'row-actions')
  })
})
