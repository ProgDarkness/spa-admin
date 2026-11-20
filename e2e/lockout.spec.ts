import { expect, test, type Page } from '@playwright/test'
import { createSeed } from '../src/lib/mock/seed'
import { openAt, OWNER_PASSWORD, OWNER_USERNAME, signInWith } from './support/auth-flows'
import { installTauriIpc, type IpcOverride } from './support/tauri-ipc'

const SESSION_LOCKED_ERROR = {
  code: 'sessionLocked',
  message: 'Sesión bloqueada. Ingresa tu contraseña para continuar',
  field: null,
  entityIds: null,
}

const INVALID_CREDENTIALS_ERROR = {
  code: 'invalidCredentials',
  message: 'Usuario o contraseña incorrectos',
  field: null,
  entityIds: null,
}

const LOCKED_VIEW = { status: 'locked', user: null }
const OWNER = createSeed('2026-11-12').users[0]

const rejectWith =
  (error: unknown): IpcOverride =>
  () => {
    throw error
  }

const respondWith =
  (value: unknown): IpcOverride =>
  () =>
    value

async function openLockedSession(page: Page, overrides: Record<string, IpcOverride>): Promise<void> {
  await installTauriIpc(page, { overrides: { current_session: respondWith(LOCKED_VIEW), ...overrides } })
  await openAt(page, '/citas/')
  await expect(page.getByRole('heading', { name: 'Sesión bloqueada' })).toBeVisible()
}

async function submitUnlock(page: Page, password: string): Promise<void> {
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Desbloquear' }).click()
}

test.describe('mock IPC con respuestas inyectadas: no simula el contador de intentos ni la expiración del bloqueo de 300 s, solo las respuestas que el backend real devuelve', () => {
  test('current_session bloqueada muestra la pantalla de desbloqueo y oculta la agenda', async ({ page }) => {
    await openLockedSession(page, {})

    await expect(page.getByRole('button', { name: 'Desbloquear' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Agenda' })).toHaveCount(0)
  })

  test('unlock rechazado con sessionLocked muestra su mensaje y mantiene la pantalla bloqueada', async ({ page }) => {
    await openLockedSession(page, { unlock: rejectWith(SESSION_LOCKED_ERROR) })

    await submitUnlock(page, 'cualquiera')

    await expect(page.locator('p[role=alert]')).toHaveText(SESSION_LOCKED_ERROR.message)
    await expect(page.getByRole('heading', { name: 'Sesión bloqueada' })).toBeVisible()
    await expect(page.getByLabel('Contraseña')).toHaveValue('')
  })

  test('unlock con la cuenta en bloqueo por intentos responde invalidCredentials aunque la contraseña sea correcta', async ({
    page,
  }) => {
    await openLockedSession(page, { unlock: rejectWith(INVALID_CREDENTIALS_ERROR) })

    await submitUnlock(page, OWNER_PASSWORD)

    await expect(page.locator('p[role=alert]')).toHaveText(INVALID_CREDENTIALS_ERROR.message)
    await expect(page.getByRole('heading', { name: 'Agenda' })).toHaveCount(0)
  })

  test('unlock exitoso tras el rechazo reanuda la sesión y muestra la agenda', async ({ page }) => {
    let attempts = 0
    await openLockedSession(page, {
      unlock: () => {
        attempts += 1
        if (attempts === 1) throw SESSION_LOCKED_ERROR
        return OWNER
      },
    })

    await submitUnlock(page, 'primero')
    await expect(page.locator('p[role=alert]')).toHaveText(SESSION_LOCKED_ERROR.message)
    await submitUnlock(page, 'segundo')

    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sesión bloqueada' })).toHaveCount(0)
  })

  test('login con la cuenta en bloqueo por intentos muestra el mensaje genérico sin distinguir bloqueo de contraseña errónea', async ({
    page,
  }) => {
    await installTauriIpc(page, { overrides: { login: rejectWith(INVALID_CREDENTIALS_ERROR) } })
    await openAt(page, '/login/')

    await signInWith(page, OWNER_USERNAME, OWNER_PASSWORD)

    await expect(page.locator('p[role=alert]')).toHaveText(INVALID_CREDENTIALS_ERROR.message)
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
  })

  test('recover_password con la cuenta en bloqueo por intentos muestra el mensaje genérico en el formulario de recuperación', async ({
    page,
  }) => {
    await installTauriIpc(page, { overrides: { recover_password: rejectWith(INVALID_CREDENTIALS_ERROR) } })
    await openAt(page, '/recover/')

    await page.getByLabel('Usuario').fill(OWNER_USERNAME)
    await page.getByLabel('Código de recuperación').fill('AAAA-AAAA-AAAA-AAAA-AAAA')
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(OWNER_PASSWORD)
    await page.getByLabel('Confirmar nueva contraseña').fill(OWNER_PASSWORD)
    await page.getByRole('button', { name: 'Restablecer contraseña' }).click()

    await expect(page.locator('p[role=alert]')).toHaveText(INVALID_CREDENTIALS_ERROR.message)
    await expect(page.getByRole('heading', { name: 'Recuperar acceso' })).toBeVisible()
  })
})
