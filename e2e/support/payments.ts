import { expect, type Locator, type Page } from '@playwright/test'

export type PaymentDraft = { method: string; currency: 'Dólares (USD)' | 'Bolívares (VES)'; amount: string }

export function paymentsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Pagos de la cita' })
}

export async function registerPayment(page: Page, draft: PaymentDraft): Promise<void> {
  const dialog = paymentsDialog(page)
  await dialog.getByLabel('Método de pago').selectOption({ label: draft.method })
  await dialog.getByLabel('Moneda').selectOption({ label: draft.currency })
  await dialog.getByLabel('Monto').fill(draft.amount)
  await dialog.getByRole('button', { name: 'Registrar pago' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Pago registrado')
}
