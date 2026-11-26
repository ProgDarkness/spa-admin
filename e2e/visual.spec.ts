import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { DEV_PASSWORD } from '../src/test/ipc/auth-backend'
import { paymentsDialog } from './support/payments'
import { FIXED_TODAY, goToSection } from './support/session'
import { installTauriIpc } from './support/tauri-ipc'

const FIXED_VISUAL_TIME = new Date(`${FIXED_TODAY}T10:15:00-04:00`)
const RECENT_BACKUP_UTC = '2026-11-11T14:00:00.000Z'
const BRONZE_RGB = 'rgb(166, 124, 59)'
const VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
]
const SCREENSHOT_OPTIONS = { fullPage: true, animations: 'disabled' as const }

test.use({ reducedMotion: 'reduce' })

async function openLoginAtFixedTime(page: Page): Promise<void> {
  const ipc = await installTauriIpc(page, { lastBackupAtUtc: RECENT_BACKUP_UTC })
  await page.clock.setFixedTime(FIXED_VISUAL_TIME)
  await page.goto('/login/')
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
  await ipc.waitForReply('setup_status')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeEnabled()
  await expect(page.getByText('No se pudo comprobar el estado del equipo')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function signInAsOwner(page: Page): Promise<void> {
  await openLoginAtFixedTime(page)
  await page.getByLabel('Usuario').fill('propietaria')
  await page.getByLabel('Contraseña').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible()
}

async function expectScreenshot(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await expect(page).toHaveScreenshot(name, SCREENSHOT_OPTIONS)
}

async function expectNoContrastOrFocusViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  const relevant = results.violations.filter((violation) => /color-contrast|focus/.test(violation.id))
  expect(relevant).toEqual([])
}

for (const viewport of VIEWPORTS) {
  test.describe(`visual ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('login', async ({ page }) => {
      await openLoginAtFixedTime(page)
      await expectNoContrastOrFocusViolations(page)
      await expectScreenshot(page, `login-${viewport.name}.png`)
    })

    test('citas día y semana', async ({ page }) => {
      await signInAsOwner(page)
      await expectNoContrastOrFocusViolations(page)
      await expectScreenshot(page, `citas-dia-${viewport.name}.png`)
      await page.getByRole('button', { name: 'Semana' }).click()
      await expect(page.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true')
      await expectScreenshot(page, `citas-semana-${viewport.name}.png`)
    })

    test('diálogo de pagos', async ({ page }) => {
      await signInAsOwner(page)
      await page.getByRole('button', { name: 'Pagos' }).first().click()
      await expect(paymentsDialog(page)).toBeVisible()
      await expectNoContrastOrFocusViolations(page)
      await expectScreenshot(page, `pagos-${viewport.name}.png`)
    })

    test('clientes, ficha y métricas', async ({ page }) => {
      await signInAsOwner(page)
      await goToSection(page, 'Clientes')
      await expectNoContrastOrFocusViolations(page)
      await expectScreenshot(page, `clientes-${viewport.name}.png`)
      await page.getByRole('link', { name: 'María González' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'María González' })).toBeVisible()
      await expectNoContrastOrFocusViolations(page)
      await expectScreenshot(page, `ficha-cliente-${viewport.name}.png`)
      await goToSection(page, 'Métricas')
      await expectNoContrastOrFocusViolations(page)
      await expectScreenshot(page, `metricas-${viewport.name}.png`)
    })
  })
}

test('foco visible con outline bronce tras Tab', async ({ page }) => {
  await signInAsOwner(page)
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveCSS('outline-color', BRONZE_RGB)
})
