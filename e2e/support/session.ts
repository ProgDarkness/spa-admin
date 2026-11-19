import { expect, test, type Locator, type Page } from '@playwright/test'
import { type SeedUsername } from '../../src/lib/mock/seed'
import { DEV_PASSWORD } from '../../src/test/ipc/auth-backend'
import { installTauriIpc } from './tauri-ipc'

export const FIXED_NOW = new Date('2026-11-12T09:00:00-04:00')
export const FIXED_TODAY = '2026-11-12'

test.beforeEach(async ({ page }) => {
  await installTauriIpc(page)
})

export async function openLogin(page: Page): Promise<void> {
  await page.clock.install({ time: FIXED_NOW })
  await page.goto('/login/')
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
}

export async function signInAs(page: Page, username: SeedUsername): Promise<void> {
  await openLogin(page)
  await page.getByLabel('Usuario').fill(username)
  await page.getByLabel('Contraseña').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
}

export function mainNavigation(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Principal' })
}

export async function goToSection(page: Page, label: string): Promise<void> {
  await mainNavigation(page).getByRole('link', { name: label }).click()
  await expect(page.getByRole('heading', { level: 1, name: label === 'Citas' ? 'Agenda' : label })).toBeVisible()
}
