import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEV_PASSWORD } from '../src/test/ipc/auth-backend'
import type { PickedBackup } from '../src/test/ipc/backup-backend'
import { openAt } from './support/auth-flows'
import { goToSection, mainNavigation, signInAs } from './support/session'
import { installTauriIpc } from './support/tauri-ipc'

const PASSPHRASE = 'frase de prueba larga'
const NEVER_EXPORTED_BANNER = 'Aún no has exportado ningún respaldo'
const RESTORED_NOTICE = 'Respaldo restaurado. Inicia sesión con una cuenta del respaldo.'
const UNREADABLE_MESSAGE = 'La frase no coincide o el archivo está dañado'
const NOT_RECOGNIZED_MESSAGE = 'El archivo no es un respaldo reconocido'
const FROM_NEWER_APP_MESSAGE = 'El respaldo fue creado con una versión más nueva de la aplicación'
const UNDERSTOOD_LABEL = 'Entiendo que se reemplazarán todos los datos actuales'
const EXPORT_SAVED = /Respaldo guardado: spa-respaldo-2026-11-12-0900\.spabak/

function exportPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Exportar respaldo' })
}

function restorePanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Restaurar respaldo' })
}

function banner(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: NEVER_EXPORTED_BANNER })
}

async function openBackupScreen(page: Page, username: 'propietaria' | 'recepcion' = 'propietaria') {
  const ipc = await signInAs(page, username)
  await goToSection(page, 'Respaldo')
  return ipc
}

async function submitRestore(panel: Locator): Promise<void> {
  await panel.getByLabel('Frase del respaldo a restaurar').fill(PASSPHRASE)
  await panel.getByRole('checkbox', { name: UNDERSTOOD_LABEL }).check()
  await panel.getByRole('button', { name: 'Restaurar respaldo' }).click()
}

test.describe('propietaria: exportar respaldo', () => {
  test('ve el banner de respaldo vencido, exporta con frase y confirmación y el banner desaparece', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await expect(banner(page)).toBeVisible()
    await banner(page).getByRole('link', { name: 'Exportar un respaldo' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Respaldo' })).toBeVisible()

    const panel = exportPanel(page)
    await panel.getByLabel('Frase del respaldo', { exact: true }).fill(PASSPHRASE)
    await panel.getByLabel('Confirmar frase').fill(PASSPHRASE)
    await panel.getByRole('button', { name: 'Exportar respaldo' }).click()

    await expect(panel.getByRole('status')).toContainText(EXPORT_SAVED)
    await goToSection(page, 'Citas')
    await expect(page.getByText(NEVER_EXPORTED_BANNER)).toHaveCount(0)
  })

  test('el banner no se repite dentro de la pantalla de respaldo', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await expect(banner(page)).toBeVisible()

    await goToSection(page, 'Respaldo')

    await expect(banner(page)).toHaveCount(0)
    await expect(restorePanel(page).getByText(NEVER_EXPORTED_BANNER)).toBeVisible()
  })

  test('una confirmación distinta de la frase no exporta y el banner sigue visible', async ({ page }) => {
    await openBackupScreen(page)
    const panel = exportPanel(page)

    await panel.getByLabel('Frase del respaldo', { exact: true }).fill(PASSPHRASE)
    await panel.getByLabel('Confirmar frase').fill(`${PASSPHRASE} distinta`)
    await panel.getByRole('button', { name: 'Exportar respaldo' }).click()

    await expect(panel.getByText(EXPORT_SAVED)).toHaveCount(0)
    await goToSection(page, 'Citas')
    await expect(banner(page)).toBeVisible()
  })

  test('cancelar el diálogo de guardado no muestra ni error ni éxito y el banner sigue', async ({ page }) => {
    const ipc = await openBackupScreen(page)
    const panel = exportPanel(page)
    ipc.setNextPickedBackup(null)

    await panel.getByLabel('Frase del respaldo', { exact: true }).fill(PASSPHRASE)
    await panel.getByLabel('Confirmar frase').fill(PASSPHRASE)
    await panel.getByRole('button', { name: 'Exportar respaldo' }).click()
    await ipc.waitForReply('export_backup')

    await expect(panel.getByRole('button', { name: 'Exportar respaldo' })).toBeEnabled()
    await expect(panel.getByText(/Respaldo guardado/)).toHaveCount(0)
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await goToSection(page, 'Citas')
    await expect(banner(page)).toBeVisible()
  })
})

test.describe('propietaria: restaurar respaldo', () => {
  const failures: readonly { pick: PickedBackup; message: string }[] = [
    { pick: 'corrupt', message: UNREADABLE_MESSAGE },
    { pick: 'wrongPassphrase', message: UNREADABLE_MESSAGE },
    { pick: 'notRecognized', message: NOT_RECOGNIZED_MESSAGE },
    { pick: 'future', message: FROM_NEWER_APP_MESSAGE },
  ]

  for (const { pick, message } of failures) {
    test(`un respaldo ${pick} muestra el mensaje exacto del backend y la sesión sigue activa`, async ({ page }) => {
      const ipc = await openBackupScreen(page)
      const panel = restorePanel(page)
      ipc.setNextPickedBackup(pick)

      await submitRestore(panel)

      await expect(panel.getByRole('alert')).toHaveText(`Error: ${message}`)
      await expect(page).toHaveURL(/\/ajustes\/respaldo\/?$/)
      await expect(page.getByRole('heading', { level: 1, name: 'Respaldo' })).toBeVisible()
      await expect(mainNavigation(page)).toBeVisible()
    })
  }

  test('un respaldo válido cierra la sesión y vuelve al login', async ({ page }) => {
    await openBackupScreen(page)

    await submitRestore(restorePanel(page))

    await expect(page).toHaveURL(/\/login\/?\?restored=1$/)
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
    await expect(page.getByLabel('Usuario')).toBeVisible()
  })

  test('un respaldo válido conserva el aviso de restauración en el login', async ({ page }) => {
    await openBackupScreen(page)

    await submitRestore(restorePanel(page))

    await expect(page).toHaveURL(/\/login\/?\?restored=1$/)
    await expect(page.getByRole('status').filter({ hasText: RESTORED_NOTICE })).toHaveCount(1)
    await expect(page.getByText(RESTORED_NOTICE)).toBeVisible()
  })

  test('cancelar el diálogo de apertura no muestra error ni éxito y la sesión sigue', async ({ page }) => {
    const ipc = await openBackupScreen(page)
    const panel = restorePanel(page)
    ipc.setNextPickedBackup(null)

    await submitRestore(panel)
    await ipc.waitForReply('restore_backup')

    await expect(panel.getByRole('button', { name: 'Restaurar respaldo' })).toBeEnabled()
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await expect(page).toHaveURL(/\/ajustes\/respaldo\/?$/)
    await expect(mainNavigation(page)).toBeVisible()
  })

  test('el botón de restaurar exige marcar la casilla de entendimiento', async ({ page }) => {
    await openBackupScreen(page)
    const panel = restorePanel(page)
    const restoreButton = panel.getByRole('button', { name: 'Restaurar respaldo' })

    await panel.getByLabel('Frase del respaldo a restaurar').fill(PASSPHRASE)
    await expect(restoreButton).toBeDisabled()

    await panel.getByRole('checkbox', { name: UNDERSTOOD_LABEL }).check()
    await expect(restoreButton).toBeEnabled()

    await panel.getByRole('checkbox', { name: UNDERSTOOD_LABEL }).uncheck()
    await expect(restoreButton).toBeDisabled()
  })
})

test.describe('recepción', () => {
  test('no ve el enlace Respaldo ni el banner de respaldo', async ({ page }) => {
    await signInAs(page, 'recepcion')

    await expect(mainNavigation(page).getByRole('link', { name: 'Citas' })).toBeVisible()
    await expect(mainNavigation(page).getByRole('link', { name: 'Respaldo' })).toHaveCount(0)
    await expect(page.getByText(NEVER_EXPORTED_BANNER)).toHaveCount(0)
  })
})

test.describe('primer arranque', () => {
  test('restaura desde /setup/restaurar, va al login con el aviso y permite entrar con una cuenta del respaldo', async ({
    page,
  }) => {
    await installTauriIpc(page, { withoutUsers: true })
    await openAt(page, '/login/')
    await expect(page.getByRole('heading', { name: 'Primer arranque' })).toBeVisible()

    await page.getByRole('link', { name: 'Restaurar desde un respaldo' }).click()
    await expect(page.getByRole('heading', { name: 'Restaurar desde un respaldo' })).toBeVisible()
    await submitRestore(restorePanel(page))

    await expect(page).toHaveURL(/\/login\/?\?restored=1$/)
    await expect(page.getByRole('status').filter({ hasText: RESTORED_NOTICE })).toHaveCount(1)
    await expect(page.getByText(RESTORED_NOTICE)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()

    await page.getByLabel('Usuario').fill('propietaria')
    await page.getByLabel('Contraseña').fill(DEV_PASSWORD)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
  })

  test('un respaldo corrupto en primer arranque muestra el error y no crea cuentas', async ({ page }) => {
    const ipc = await installTauriIpc(page, { withoutUsers: true })
    await openAt(page, '/setup/restaurar/')
    ipc.setNextPickedBackup('corrupt')

    await submitRestore(restorePanel(page))

    await expect(restorePanel(page).getByRole('alert')).toHaveText(`Error: ${UNREADABLE_MESSAGE}`)
    await expect(page).toHaveURL(/\/setup\/restaurar\/?$/)
  })
})

test.describe('accesibilidad', () => {
  test('la pantalla de respaldo no tiene violaciones axe de contraste ni de foco', async ({ page }) => {
    await openBackupScreen(page)
    await expect(restorePanel(page)).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()

    expect(results.violations.filter((violation) => /color-contrast|focus/.test(violation.id))).toEqual([])
  })
})
