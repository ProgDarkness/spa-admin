import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from './table'

function renderTable() {
  return render(
    <Table className="extra">
      <TableCaption>Servicios</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Precio</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Masaje</TableCell>
          <TableCell>40</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell>40</TableCell>
        </TableRow>
      </TableFooter>
    </Table>,
  )
}

describe('Table', () => {
  it('expone la semantica de tabla con cabeceras, filas y celdas', () => {
    renderTable()

    const table = screen.getByRole('table', { name: 'Servicios' })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Nombre',
      'Precio',
    ])
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByRole('cell', { name: 'Masaje' })).toHaveAttribute('data-slot', 'table-cell')
    expect(within(table).getAllByRole('cell')).toHaveLength(4)
  })

  it('envuelve la tabla en un contenedor con scroll horizontal y combina className', () => {
    renderTable()

    const table = screen.getByRole('table')
    expect(table).toHaveAttribute('data-slot', 'table')
    expect(table).toHaveClass('extra', 'w-full', 'text-sm')
    expect(table.parentElement).toHaveAttribute('data-slot', 'table-container')
    expect(table.parentElement).toHaveClass('overflow-x-auto')
  })

  it('las filas y el pie usan border-border', () => {
    renderTable()

    const bodyRow = screen.getByRole('cell', { name: 'Masaje' }).closest('tr')
    expect(bodyRow).toHaveAttribute('data-slot', 'table-row')
    expect(bodyRow).toHaveClass('border-b', 'border-border')
    expect(document.querySelector('[data-slot="table-header"]')).toHaveClass('[&_tr]:border-border')
    expect(document.querySelector('[data-slot="table-footer"]')).toHaveClass('border-t', 'border-border')
  })

  it('la cabecera usa data-slot table-head y color foreground', () => {
    renderTable()

    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toHaveAttribute('data-slot', 'table-head')
    expect(screen.getByRole('columnheader', { name: 'Nombre' })).toHaveClass('h-10', 'text-foreground')
  })
})
