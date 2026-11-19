import { expect, type Locator, type Page } from '@playwright/test'

export type AppointmentDraft = {
  client: string
  service: string
  resource: string
  startsAt: string
}

export function newAppointmentDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Nueva cita' })
}

export async function fillAppointmentForm(page: Page, draft: AppointmentDraft): Promise<Locator> {
  const dialog = newAppointmentDialog(page)
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Cliente').selectOption({ label: draft.client })
  await dialog.getByLabel('Servicio').selectOption({ label: draft.service })
  await dialog.getByLabel('Recurso').selectOption({ label: draft.resource })
  await dialog.getByLabel('Fecha y hora').fill(draft.startsAt)
  return dialog
}

export async function submitAppointment(page: Page, draft: AppointmentDraft): Promise<Locator> {
  const dialog = await fillAppointmentForm(page, draft)
  await dialog.getByRole('button', { name: 'Crear cita' }).click()
  return dialog
}

export function appointmentCard(page: Page, clientName: string, time: string): Locator {
  return page.getByRole('article', { name: `Cita de ${clientName} a las ${time}` })
}
