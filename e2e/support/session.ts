import { expect, type Locator, type Page } from '@playwright/test'
import { type SeedUsername } from '../../src/lib/mock/seed'
import { DEV_PASSWORD } from '../../src/test/ipc/auth-backend'
import { installTauriIpc, type TauriIpcHandle } from './tauri-ipc'

export const FIXED_NOW = new Date('2026-11-12T09:00:00-04:00')
export const FIXED_TODAY = '2026-11-12'

export interface SessionOptions {
  now?: Date
}

export async function openLogin(page: Page, { now = FIXED_NOW }: SessionOptions = {}): Promise<TauriIpcHandle> {
  const ipc = await installTauriIpc(page)
  await page.clock.install({ time: now })
  await page.goto('/login/')
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
  return ipc
}

export async function signInAs(
  page: Page,
  username: SeedUsername,
  options: SessionOptions = {},
): Promise<TauriIpcHandle> {
  const ipc = await openLogin(page, options)
  await page.getByLabel('Usuario').fill(username)
  await page.getByLabel('Contraseña').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
  return ipc
}

export function mainNavigation(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Principal' })
}

const SECTION_HEADINGS: Readonly<Record<string, string>> = { Citas: 'Agenda', Tasas: 'Tasas de cambio' }

export async function goToSection(page: Page, label: string, heading = SECTION_HEADINGS[label] ?? label): Promise<void> {
  await mainNavigation(page).getByRole('link', { name: label }).click()
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
}
