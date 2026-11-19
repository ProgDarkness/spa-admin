import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClientNotFound } from './client-not-found'

describe('ClientNotFound', () => {
  it('muestra el título y la explicación', () => {
    render(<ClientNotFound />)

    expect(screen.getByRole('heading', { level: 1, name: 'Cliente no encontrado' })).toBeInTheDocument()
    expect(screen.getByText('El cliente solicitado no existe o el enlace no es válido.')).toBeInTheDocument()
  })

  it('ofrece un enlace de vuelta al listado de clientes', () => {
    render(<ClientNotFound />)

    expect(screen.getByRole('link', { name: 'Volver a clientes' })).toHaveAttribute('href', '/clientes')
  })

  it('el título y el enlace de vuelta están dentro de un estado vacío', () => {
    const { container } = render(<ClientNotFound />)

    const emptyState = container.querySelector<HTMLElement>('[data-slot="empty-state"]')
    expect(emptyState).not.toBeNull()
    const scope = within(emptyState as HTMLElement)
    expect(scope.getByRole('heading', { level: 1, name: 'Cliente no encontrado' })).toBeInTheDocument()
    expect(scope.getByRole('link', { name: 'Volver a clientes' })).toHaveAttribute('href', '/clientes')
  })
})
