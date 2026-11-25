import { expect, type Locator, type Page } from '@playwright/test'
import { goToSection } from './session'

export type PaymentDraft = {
  method: string
  currency: 'Dólares (USD)' | 'Bolívares (VES)'
  amount: string
  rate?: string
}

export function paymentsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Pagos de la cita' })
}

export async function submitPayment(page: Page, draft: PaymentDraft): Promise<Locator> {
  const dialog = paymentsDialog(page)
  await dialog.getByLabel('Método de pago').selectOption({ label: draft.method })
  await dialog.getByLabel('Moneda').selectOption({ label: draft.currency })
  await dialog.getByLabel('Monto').fill(draft.amount)
  if (draft.rate !== undefined) await dialog.getByLabel('Tasa (Bs por USD)').fill(draft.rate)
  await dialog.getByRole('button', { name: 'Registrar pago' }).click()
  return dialog
}

export async function registerPayment(page: Page, draft: PaymentDraft): Promise<void> {
  const dialog = await submitPayment(page, draft)
  await expect(dialog.getByRole('status')).toHaveText('Pago registrado')
}

export async function openClientHistory(page: Page, fullName: string): Promise<void> {
  await goToSection(page, 'Clientes')
  await page.getByRole('link', { name: fullName }).click()
  await expect(page.getByRole('heading', { level: 1, name: fullName })).toBeVisible()
}

export function historyEntry(page: Page, startsAt: string): Locator {
  return page
    .getByRole('list', { name: 'Historial de citas' })
    .getByRole('listitem')
    .filter({ hasText: startsAt })
}

export async function openEntryPayments(page: Page, startsAt: string): Promise<Locator> {
  await historyEntry(page, startsAt).getByRole('button', { name: 'Pagos' }).click()
  const dialog = paymentsDialog(page)
  await expect(dialog).toBeVisible()
  return dialog
}

export async function closePaymentsDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(paymentsDialog(page)).toBeHidden()
}

export function historySummary(page: Page): Locator {
  return page.getByRole('region', { name: 'Resumen' })
}

export type PaymentRecord = {
  id: number
  appointmentId: number
  currency: string
  amountCents: number
  rateBsPerUsdE4: number | null
  usdEquivalentCents: number
  voidedAt: string | null
  voidReason: string | null
}
