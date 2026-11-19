import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { setPathname } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import { AppShell } from './app-shell'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

async function renderShell(as: 'propietaria' | 'recepcion' | 'lectura') {
  const rendered = renderWithProviders(
    <AppShell>
      <p>contenido de página</p>
    </AppShell>,
    { as },
  )
  const navigation = await screen.findByRole('navigation', { name: 'Principal' })
  await screen.findByText(as)
  return { ...rendered, navigation }
}

describe('AppShell', () => {
  it('oculta Métricas a recepcion', async () => {
    const { navigation } = await renderShell('recepcion')

    expect(within(navigation).queryByRole('link', { name: 'Métricas' })).not.toBeInTheDocument()
  })

  it('muestra Métricas a propietaria', async () => {
    const { navigation } = await renderShell('propietaria')

    expect(within(navigation).getByRole('link', { name: 'Métricas' })).toHaveAttribute('href', '/metricas')
  })

  it('lista solo los destinos permitidos para recepcion', async () => {
    const { navigation } = await renderShell('recepcion')

    const labels = within(navigation)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(labels).toEqual(['Citas', 'Clientes', 'Catálogo', 'Tasas'])
  })

  it('lista solo los destinos permitidos para lectura', async () => {
    const { navigation } = await renderShell('lectura')

    const labels = within(navigation)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(labels).toEqual(['Citas', 'Clientes', 'Catálogo'])
  })

  it('lista todos los destinos para propietaria', async () => {
    const { navigation } = await renderShell('propietaria')

    expect(within(navigation).getAllByRole('link')).toHaveLength(6)
  })

  it('muestra el nombre de usuario y el rol', async () => {
    await renderShell('recepcion')

    expect(screen.getByText('recepcion')).toBeInTheDocument()
    expect(screen.getByText('Recepción')).toBeInTheDocument()
  })

  it('marca el destino activo con aria-current', async () => {
    setPathname('/citas')
    const { navigation } = await renderShell('propietaria')

    expect(within(navigation).getByRole('link', { name: 'Citas' })).toHaveAttribute('aria-current', 'page')
    expect(within(navigation).getByRole('link', { name: 'Clientes' })).not.toHaveAttribute('aria-current')
  })

  it('renderiza el contenido de la página en main', async () => {
    await renderShell('lectura')

    expect(within(screen.getByRole('main')).getByText('contenido de página')).toBeInTheDocument()
  })

  it('agrupa la navegación Principal y el BrandLogo dentro de aside', async () => {
    const { navigation } = await renderShell('propietaria')

    const aside = screen.getByRole('complementary')
    expect(within(aside).getByRole('navigation', { name: 'Principal' })).toBe(navigation)
    expect(within(aside).getByRole('img', { name: 'Spa' })).toBeInTheDocument()
  })

  it('cierra la sesión con el botón Cerrar sesión', async () => {
    const { user } = await renderShell('propietaria')

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    await waitFor(() => expect(getState().sessionUserId).toBeNull())
    expect(screen.queryByText('propietaria')).not.toBeInTheDocument()
  })
})
