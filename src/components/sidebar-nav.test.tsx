import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { PermissionKey } from '@/lib/model'
import { setPathname } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import { signInAs } from '@/test/session'
import { SidebarNav } from './sidebar-nav'

beforeEach(() => {
  resetStore()
})

function renderWithOnlyPermissions(permissions: readonly PermissionKey[]) {
  signInAs('lectura')
  const original = getState()
  commit({
    ...original,
    users: original.users.map((candidate) =>
      candidate.id === original.sessionUserId ? { ...candidate, permissions: [...permissions] } : candidate,
    ),
  })
  return renderWithProviders(<SidebarNav />)
}

describe('SidebarNav', () => {
  it('lista solo los destinos permitidos para lectura', async () => {
    renderWithProviders(<SidebarNav />, { as: 'lectura' })

    const navigation = await screen.findByRole('navigation', { name: 'Principal' })
    await within(navigation).findByRole('link', { name: 'Citas' })
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Citas', 'Clientes', 'Catálogo', 'Métodos de pago'])
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

  it('muestra Métodos de pago a quien solo tiene payments.read', async () => {
    renderWithOnlyPermissions(['payments.read'])

    expect(await screen.findByRole('link', { name: 'Métodos de pago' })).toBeInTheDocument()
  })

  it('muestra Métodos de pago a quien solo tiene catalog.read', async () => {
    renderWithOnlyPermissions(['catalog.read'])

    expect(await screen.findByRole('link', { name: 'Métodos de pago' })).toBeInTheDocument()
  })

  it('oculta Métodos de pago sin catalog.read ni payments.read', async () => {
    renderWithOnlyPermissions(['clients.read'])

    await screen.findByRole('link', { name: 'Clientes' })
    expect(screen.queryByRole('link', { name: 'Métodos de pago' })).not.toBeInTheDocument()
  })
})
