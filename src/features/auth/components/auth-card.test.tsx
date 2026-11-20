import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthCard } from './auth-card'

describe('AuthCard', () => {
  it('expone una región nombrada por el título con logo y contenido', () => {
    render(
      <AuthCard title="Título de prueba">
        <p>contenido</p>
      </AuthCard>,
    )

    const region = screen.getByRole('region', { name: 'Título de prueba' })
    expect(within(region).getByRole('heading', { level: 1, name: 'Título de prueba' })).toBeInTheDocument()
    expect(within(region).getByRole('img', { name: 'Spa' })).toBeInTheDocument()
    expect(within(region).getByText('contenido')).toBeInTheDocument()
    expect(screen.getByRole('main')).toContainElement(region)
  })
})
