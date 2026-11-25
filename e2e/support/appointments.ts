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

export type AppointmentRecord = {
  id: number
  clientId: number
  serviceId: number
  resourceId: number
  startsAt: string
  endsAt: string
  status: string
  priceCentsSnapshot: number
  durationMinSnapshot: number
}

export function localDateTimeToday(today: string, time: string): string {
  return `${today}T${time}`
}

export async function bookAppointment(page: Page, draft: AppointmentDraft): Promise<Locator> {
  await page.getByRole('button', { name: 'Nueva cita' }).click()
  const dialog = await submitAppointment(page, draft)
  await expect(dialog).toBeHidden()
  return appointmentCard(page, draft.client, draft.startsAt.slice(-5))
}

export async function rejectedBooking(page: Page, draft: AppointmentDraft): Promise<Locator> {
  await page.getByRole('button', { name: 'Nueva cita' }).click()
  const dialog = await submitAppointment(page, draft)
  await expect(dialog).toBeVisible()
  return dialog
}

export function actionButton(card: Locator, verb: string, clientName: string): Locator {
  return card.getByRole('button', { name: `${verb} cita de ${clientName}` })
}

export function resourceColumn(page: Page, resourceName: string): Locator {
  return page.getByRole('region', { name: `Recurso ${resourceName}` })
}

export async function invokeCommand(page: Page, command: string, args: unknown): Promise<unknown> {
  return page.evaluate(
    async ([cmd, payload]) => {
      const host = window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<unknown> } }
      try {
        return { resolved: true, value: await host.__TAURI_INTERNALS__.invoke(cmd as string, payload) }
      } catch (caught) {
        return { resolved: false, payload: caught }
      }
    },
    [command, args] as const,
  )
}

export async function allAppointments(page: Page): Promise<AppointmentRecord[]> {
  const outcome = (await invokeCommand(page, 'list_all_appointments', undefined)) as {
    resolved: boolean
    value: AppointmentRecord[]
  }
  expect(outcome.resolved).toBe(true)
  return outcome.value
}

export function appointmentById(rows: readonly AppointmentRecord[], id: number): AppointmentRecord {
  const found = rows.find((row) => row.id === id)
  if (!found) throw new Error(`Cita ${id} inexistente en el backend simulado`)
  return found
}
