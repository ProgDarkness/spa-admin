import { expect, type Page } from '@playwright/test'

export const FIXED_NOW = new Date('2026-11-12T09:00:00-04:00')
export const OWNER_USERNAME = 'propietaria'
export const OWNER_PASSWORD = 'clave-larga-1'
export const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/
export const SAVED_CODE_LABEL = 'Guardé mi código de recuperación'

export async function openAt(page: Page, path: string): Promise<void> {
  await page.clock.install({ time: FIXED_NOW })
  await page.goto(path)
}

export async function signInWith(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('Usuario').fill(username)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
}

export async function acknowledgeRecoveryCode(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  await page.getByRole('checkbox', { name: SAVED_CODE_LABEL }).check()
  await page.getByRole('button', { name: 'Continuar' }).click()
}
