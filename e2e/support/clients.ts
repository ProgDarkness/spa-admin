import { expect, type Locator, type Page } from '@playwright/test'

export type ClientDraft = { firstName: string; lastName: string; nationalId: string; phone: string }

export async function openNewClientDialog(page: Page) {
  await page.getByRole('button', { name: 'Nuevo cliente' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo cliente' })
  await expect(dialog).toBeVisible()
  return dialog
}

export async function fillClientForm(page: Page, draft: ClientDraft): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Nuevo cliente' })
  await dialog.getByLabel('Nombre').fill(draft.firstName)
  await dialog.getByLabel('Apellido').fill(draft.lastName)
  await dialog.getByLabel('Cédula').fill(draft.nationalId)
  await dialog.getByLabel('Teléfono').fill(draft.phone)
}

export function clientRow(page: Page, text: string): Locator {
  return page.getByRole('row').filter({ hasText: text })
}

export async function searchClients(page: Page, query: string): Promise<void> {
  await page.getByLabel('Buscar clientes').fill(query)
}

export async function saveNewClient(page: Page, draft: ClientDraft): Promise<Locator> {
  const dialog = await openNewClientDialog(page)
  await fillClientForm(page, draft)
  await dialog.getByRole('button', { name: 'Guardar cliente' }).click()
  return dialog
}
