import { expect, test } from '@playwright/test'
import { DEV_PASSWORD } from '../src/test/ipc/auth-backend'
import { canonicalRecoveryCode, formatRecoveryCode } from '../src/test/ipc/recovery-codes'
import {
  acknowledgeRecoveryCode,
  openAt,
  OWNER_PASSWORD,
  OWNER_USERNAME,
  RECOVERY_CODE_PATTERN,
  signInWith,
} from './support/auth-flows'
import { installTauriIpc } from './support/tauri-ipc'

const IDLE_MS = 11 * 60_000

const NEW_OWNER_USERNAME = 'dueña-nueva'

test('e2e_first_run_owner_flow', async ({ page }) => {
  await installTauriIpc(page, { withoutUsers: true })

  await openAt(page, '/login/')

  await expect(page.getByRole('heading', { name: 'Primer arranque' })).toBeVisible()
  await page.getByLabel('Usuario').fill(NEW_OWNER_USERNAME)
  await page.getByLabel('Contraseña', { exact: true }).fill('corta')
  await page.getByLabel('Confirmar contraseña').fill('corta')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(page.getByText('La contraseña debe tener al menos 10 caracteres')).toBeVisible()

  await page.getByLabel('Contraseña', { exact: true }).fill(OWNER_PASSWORD)
  await page.getByLabel('Confirmar contraseña').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'Crear cuenta' }).click()

  const code = page.getByText(RECOVERY_CODE_PATTERN)
  await expect(code).toBeVisible()
  const shownCode = (await code.textContent()) ?? ''
  await acknowledgeRecoveryCode(page)

  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
  await expect(page.getByText(shownCode)).toHaveCount(0)
})

test('e2e_idle_lock_then_unlock', async ({ page }) => {
  const ipc = await installTauriIpc(page)
  await openAt(page, '/login/')
  await signInWith(page, OWNER_USERNAME, DEV_PASSWORD)
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()

  await ipc.advanceClock(IDLE_MS)

  await expect(page.getByRole('heading', { name: 'Sesión bloqueada' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Agenda' })).toHaveCount(0)
  await page.getByLabel('Contraseña').fill('incorrecta')
  await page.getByRole('button', { name: 'Desbloquear' }).click()
  await expect(page.getByText('Usuario o contraseña incorrectos')).toBeVisible()

  await page.getByLabel('Contraseña').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Desbloquear' }).click()

  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
})

test('e2e_recovery_rotates_code', async ({ page }) => {
  await installTauriIpc(page, { recoverableUsernames: [OWNER_USERNAME] })
  await openAt(page, '/login/')

  await page.getByRole('link', { name: 'Recuperar acceso' }).click()
  await expect(page.getByRole('heading', { name: 'Recuperar acceso' })).toBeVisible()
  await page.getByLabel('Usuario').fill(OWNER_USERNAME)
  await page.getByLabel('Código de recuperación').fill(canonicalRecoveryCode(0).toLowerCase())
  await page.getByLabel('Nueva contraseña', { exact: true }).fill(OWNER_PASSWORD)
  await page.getByLabel('Confirmar nueva contraseña').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'Restablecer contraseña' }).click()

  await expect(page.getByText(formatRecoveryCode(1))).toBeVisible()
  await acknowledgeRecoveryCode(page)
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
  await expect(page.getByText(formatRecoveryCode(1))).toHaveCount(0)

  await signInWith(page, OWNER_USERNAME, DEV_PASSWORD)
  await expect(page.getByText('Usuario o contraseña incorrectos')).toBeVisible()
  await signInWith(page, OWNER_USERNAME, OWNER_PASSWORD)

  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
})
