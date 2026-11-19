import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { setPathname } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import { SidebarNav } from './sidebar-nav'

beforeEach(() => {
  resetStore()
})

describe('SidebarNav', () => {
  it('lista solo los destinos permitidos para lectura', async () => {
    renderWithProviders(<SidebarNav />, { as: 'lectura' })

    const navigation = await screen.findByRole('navigation', { name: 'Principal' })
    await within(navigation).findByRole('link', { name: 'Citas' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Citas', 'Clientes', 'Catálogo'])
  })

  it('marca el destino activo y deja el resto sin aria-current', async () => {
    setPathname('/clientes')
    renderWithProviders(<SidebarNav />, { as: 'propietaria' })

    expect(await screen.findByRole('link', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Citas' })).not.toHaveAttribute('aria-current')
  })

  it('aplica minúsculas solo por CSS', async () => {
    renderWithProviders(<SidebarNav />, { as: 'propietaria' })

    const link = await screen.findByRole('link', { name: 'Citas' })
    expect(link).toHaveClass('lowercase')
    expect(link.textContent).toBe('Citas')
  })
})
