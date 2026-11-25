import { expect, test } from '@playwright/test'
import {
  actionButton,
  allAppointments,
  appointmentById,
  bookAppointment,
  invokeCommand,
  rejectedBooking,
  resourceColumn,
  type AppointmentDraft,
} from './support/appointments'
import { FIXED_TODAY, goToSection, signInAs } from './support/session'

const FACIAL = 'Limpieza facial (ejemplo)'
const MASSAGE = 'Masaje relajante (ejemplo)'
const OVERLAP_MESSAGE = 'El recurso ya tiene una cita en ese horario'
const CROSSES_MIDNIGHT_MESSAGE = 'La cita no puede terminar después de la medianoche'
const FUTURE_APPOINTMENTS_MESSAGE = 'El recurso tiene citas futuras que deben reubicarse antes de desactivarlo'
const INVALID_TRANSITION_MESSAGE = 'La cita no admite esa operación en su estado actual'
const FORBIDDEN_ERROR = { code: 'forbidden', message: 'No tienes permiso para esta acción' }
const SEED_APPOINTMENT_COUNT = 16
const SEED_IN_PROGRESS_ID = 11
const SEED_TOMORROW_CABIN_ONE_ID = 5
const SEED_CANCELLED_ID = 10
const MASSAGE_PRICE_CENTS = 4_000

function draft(client: string, resource: string, time: string, service = FACIAL): AppointmentDraft {
  return { client, service, resource, startsAt: `${FIXED_TODAY}T${time}` }
}

function clockAt(time: string): Date {
  return new Date(`${FIXED_TODAY}T${time}:00-04:00`)
}

test.describe('propietaria: citas', () => {
  test('crea una cita con el snapshot de precio y duración del servicio y la persiste en el backend', async ({ page }) => {
    await signInAs(page, 'propietaria')

    const card = await bookAppointment(page, draft('Ana Pérez', 'Cabina 1', '14:00', MASSAGE))

    await expect(card).toContainText('14:00 – 15:00')
    await expect(card).toContainText(MASSAGE)
    await expect(card).toContainText('Programada')
    await expect(resourceColumn(page, 'Cabina 1').getByRole('article', { name: /Cita de Ana Pérez/ })).toHaveCount(1)

    const stored = await allAppointments(page)
    expect(stored).toHaveLength(SEED_APPOINTMENT_COUNT + 1)
    expect(appointmentById(stored, SEED_APPOINTMENT_COUNT + 1)).toMatchObject({
      id: SEED_APPOINTMENT_COUNT + 1,
      clientId: 3,
      serviceId: 2,
      resourceId: 1,
      startsAt: `${FIXED_TODAY}T14:00`,
      endsAt: `${FIXED_TODAY}T15:00`,
      status: 'scheduled',
      priceCentsSnapshot: MASSAGE_PRICE_CENTS,
      durationMinSnapshot: 60,
    })
  })

  test('rechaza el solape con el mensaje de Rust y la cita en conflicto, pero acepta la que empieza justo al terminar la otra', async ({
    page,
  }) => {
    await signInAs(page, 'propietaria')

    const overlapping = await rejectedBooking(page, draft('José Rodríguez', 'Cabina 2', '15:30'))
    await expect(overlapping.getByText(OVERLAP_MESSAGE)).toBeVisible()
    await expect(overlapping.getByText(`Citas en conflicto: #${SEED_IN_PROGRESS_ID}`)).toBeVisible()
    expect(await allAppointments(page)).toHaveLength(SEED_APPOINTMENT_COUNT)
    await overlapping.getByRole('button', { name: 'Cancelar' }).click()
    await expect(overlapping).toBeHidden()

    const adjacent = await bookAppointment(page, draft('José Rodríguez', 'Cabina 2', '15:00'))
    await expect(adjacent).toContainText('15:00 – 16:00')
    expect(await allAppointments(page)).toHaveLength(SEED_APPOINTMENT_COUNT + 1)
  })

  test('23:30 con 60 min cruza la medianoche y se rechaza; 23:00 con 60 min termina a las 00:00 y se acepta', async ({
    page,
  }) => {
    await signInAs(page, 'propietaria')

    const crossing = await rejectedBooking(page, draft('Luis Martínez', 'Cabina 1', '23:30'))
    await expect(crossing.getByText(CROSSES_MIDNIGHT_MESSAGE)).toBeVisible()
    await expect(page.getByRole('article', { name: /Cita de Luis Martínez a las 23:30/ })).toHaveCount(0)
    expect(await allAppointments(page)).toHaveLength(SEED_APPOINTMENT_COUNT)
    await crossing.getByRole('button', { name: 'Cancelar' }).click()

    const accepted = await bookAppointment(page, draft('Luis Martínez', 'Cabina 1', '23:00'))
    await expect(accepted).toContainText('23:00 – 00:00')
    expect(appointmentById(await allAppointments(page), SEED_APPOINTMENT_COUNT + 1)).toMatchObject({
      startsAt: `${FIXED_TODAY}T23:00`,
      endsAt: '2026-11-13T00:00',
    })
  })

  test('mueve una cita a otro recurso y hora, y rechaza el movimiento que solapa', async ({ page }) => {
    await signInAs(page, 'propietaria')
    const card = await bookAppointment(page, draft('Carla Hernández', 'Cabina 1', '10:00'))

    await actionButton(card, 'Mover', 'Carla Hernández').click()
    const dialog = page.getByRole('dialog', { name: 'Mover cita de Carla Hernández' })
    await dialog.getByLabel('Recurso').selectOption({ label: 'Cabina 2' })
    await dialog.getByLabel('Fecha y hora').fill(`${FIXED_TODAY}T15:30`)
    await dialog.getByRole('button', { name: 'Mover' }).click()
    await expect(dialog.getByText(OVERLAP_MESSAGE)).toBeVisible()
    await expect(dialog.getByText(`Citas en conflicto: #${SEED_IN_PROGRESS_ID}`)).toBeVisible()
    expect(appointmentById(await allAppointments(page), SEED_APPOINTMENT_COUNT + 1)).toMatchObject({
      resourceId: 1,
      startsAt: `${FIXED_TODAY}T10:00`,
    })

    await dialog.getByLabel('Fecha y hora').fill(`${FIXED_TODAY}T11:00`)
    await dialog.getByRole('button', { name: 'Mover' }).click()
    await expect(dialog).toBeHidden()

    const cabinTwo = resourceColumn(page, 'Cabina 2')
    const moved = cabinTwo.getByRole('article', { name: 'Cita de Carla Hernández a las 11:00' })
    await expect(moved).toContainText('11:00 – 12:00')
    await expect(resourceColumn(page, 'Cabina 1').getByRole('article', { name: /Cita de Carla Hernández/ })).toHaveCount(0)
    expect(appointmentById(await allAppointments(page), SEED_APPOINTMENT_COUNT + 1)).toMatchObject({
      resourceId: 2,
      startsAt: `${FIXED_TODAY}T11:00`,
      endsAt: `${FIXED_TODAY}T12:00`,
      status: 'scheduled',
    })
  })

  test('cancelar una cita libera el hueco: antes se rechaza otra en el mismo horario y después se acepta', async ({
    page,
  }) => {
    await signInAs(page, 'propietaria')
    const first = await bookAppointment(page, draft('Pedro Díaz', 'Cabina 1', '10:00'))

    const blocked = await rejectedBooking(page, draft('Gabriela Torres', 'Cabina 1', '10:00'))
    await expect(blocked.getByText(OVERLAP_MESSAGE)).toBeVisible()
    await blocked.getByRole('button', { name: 'Cancelar' }).click()
    await expect(blocked).toBeHidden()

    await actionButton(first, 'Cancelar', 'Pedro Díaz').click()
    await expect(first).toContainText('Cancelada')

    const second = await bookAppointment(page, draft('Gabriela Torres', 'Cabina 1', '10:00'))
    await expect(second).toContainText('Programada')
    await expect(first).toContainText('Cancelada')
    const stored = await allAppointments(page)
    expect([SEED_APPOINTMENT_COUNT + 1, SEED_APPOINTMENT_COUNT + 2].map((id) => appointmentById(stored, id))).toMatchObject([
      { clientId: 6, status: 'cancelled' },
      { clientId: 7, status: 'scheduled' },
    ])
  })

  for (const { time, offersShortcut } of [
    { time: '09:59', offersShortcut: false },
    { time: '10:00', offersShortcut: true },
  ]) {
    test(`con el reloj a las ${time} el atajo Completar ${offersShortcut ? 'aparece' : 'no aparece'} en una cita de las 10:00`, async ({
      page,
    }) => {
      await signInAs(page, 'propietaria', { now: clockAt(time) })
      const card = await bookAppointment(page, draft('Sofía Ramírez', 'Cabina 1', '10:00'))
      const complete = actionButton(card, 'Completar', 'Sofía Ramírez')

      await expect(actionButton(card, 'Iniciar', 'Sofía Ramírez')).toBeVisible()
      if (!offersShortcut) {
        await expect(complete).toHaveCount(0)
        const rejected = await invokeCommand(page, 'transition_appointment', {
          request: { id: SEED_APPOINTMENT_COUNT + 1, transition: 'complete' },
        })
        expect(rejected).toEqual({
          resolved: false,
          payload: expect.objectContaining({ code: 'invalidTransition', message: INVALID_TRANSITION_MESSAGE }),
        })
        await expect(card).toContainText('Programada')
        return
      }
      await complete.click()
      await expect(card).toContainText('Completada')
      expect(appointmentById(await allAppointments(page), SEED_APPOINTMENT_COUNT + 1).status).toBe('completed')
    })
  }
})

test.describe('reabrir citas', () => {
  test('la Propietaria reabre una cancelada, y no puede si otra ocupó el hueco', async ({ page }) => {
    await signInAs(page, 'propietaria')
    const card = await bookAppointment(page, draft('Luis Martínez', 'Cabina 1', '10:00'))
    await actionButton(card, 'Cancelar', 'Luis Martínez').click()
    await expect(card).toContainText('Cancelada')

    await actionButton(card, 'Reabrir', 'Luis Martínez').click()
    await expect(card).toContainText('Programada')

    await actionButton(card, 'Cancelar', 'Luis Martínez').click()
    await expect(card).toContainText('Cancelada')
    const occupant = await bookAppointment(page, draft('Ana Pérez', 'Cabina 1', '10:00'))
    await actionButton(card, 'Reabrir', 'Luis Martínez').dispatchEvent('click')
    await expect(card.getByText(OVERLAP_MESSAGE)).toBeVisible()
    await expect(card).toContainText('Cancelada')
    await expect(occupant).toContainText('Programada')
  })

  test('Recepción no ve Reabrir y la mutación por IPC se rechaza sin alterar la cita', async ({ page }) => {
    await signInAs(page, 'recepcion')
    const card = await bookAppointment(page, draft('Luis Martínez', 'Cabina 1', '10:00'))
    await actionButton(card, 'Cancelar', 'Luis Martínez').click()
    await expect(card).toContainText('Cancelada')

    await expect(card.getByRole('button', { name: /Reabrir/ })).toHaveCount(0)

    const before = await allAppointments(page)
    for (const id of [SEED_CANCELLED_ID, SEED_APPOINTMENT_COUNT + 1]) {
      expect(await invokeCommand(page, 'transition_appointment', { request: { id, transition: 'reopen' } })).toEqual({
        resolved: false,
        payload: expect.objectContaining(FORBIDDEN_ERROR),
      })
    }
    expect(await allAppointments(page)).toEqual(before)
    expect(before.find((row) => row.id === SEED_CANCELLED_ID)?.status).toBe('cancelled')
    await expect(card).toContainText('Cancelada')
  })
})

test.describe('recursos con citas futuras', () => {
  test('desactivar la Cabina 1 se bloquea y lista la cita 5; las que ya terminaron no bloquean', async ({ page }) => {
    await signInAs(page, 'propietaria')
    const finished = await invokeCommand(page, 'create_appointment', {
      input: { clientId: 4, serviceId: 1, resourceId: 1, startsAt: `${FIXED_TODAY}T08:00`, notes: null },
    })
    expect(finished).toMatchObject({ resolved: true, value: { endsAt: `${FIXED_TODAY}T09:00`, status: 'scheduled' } })

    await goToSection(page, 'Recursos')
    await page.getByRole('button', { name: 'Desactivar Cabina 1' }).click()
    const confirmation = page.getByRole('dialog', { name: 'Desactivar Cabina 1' })
    await confirmation.getByRole('button', { name: 'Desactivar' }).click()

    const alert = confirmation.getByRole('alert')
    await expect(alert).toHaveText(FUTURE_APPOINTMENTS_MESSAGE)
    const blocking = confirmation.getByRole('listitem')
    await expect(blocking).toHaveCount(1)
    await expect(blocking).toHaveText(`Cita #${SEED_TOMORROW_CABIN_ONE_ID} · 2026-11-13 16:00 · Cabina 1`)

    await confirmation.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('row').filter({ hasText: 'Cabina 1' })).toContainText('Activo')
  })

  test('tras cancelar la cita 5 el recurso 1 ya se puede desactivar', async ({ page }) => {
    await signInAs(page, 'propietaria')
    const cancelled = await invokeCommand(page, 'transition_appointment', {
      request: { id: SEED_TOMORROW_CABIN_ONE_ID, transition: 'cancel' },
    })
    expect(cancelled).toMatchObject({ resolved: true, value: { id: SEED_TOMORROW_CABIN_ONE_ID, status: 'cancelled' } })

    await goToSection(page, 'Recursos')
    await page.getByRole('button', { name: 'Desactivar Cabina 1' }).click()
    const confirmation = page.getByRole('dialog', { name: 'Desactivar Cabina 1' })
    await confirmation.getByRole('button', { name: 'Desactivar' }).click()

    await expect(confirmation).toBeHidden()
    await expect(page.getByRole('row').filter({ hasText: 'Cabina 1' })).toContainText('Inactivo')
  })
})

test.describe('pagos de citas creadas en la sesión', () => {
  test('el pago registrado en una cita nueva aparece en el historial del cliente', async ({ page }) => {
    await signInAs(page, 'propietaria')
    const card = await bookAppointment(page, draft('Ana Pérez', 'Cabina 1', '10:00', MASSAGE))

    await card.getByRole('button', { name: 'Pagos' }).click()
    const payments = page.getByRole('dialog', { name: 'Pagos de la cita' })
    await payments.getByLabel('Método de pago').selectOption({ label: 'Zelle' })
    await payments.getByLabel('Moneda').selectOption({ label: 'Dólares (USD)' })
    await payments.getByLabel('Monto').fill('40,00')
    await payments.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(payments.getByRole('status')).toHaveText('Pago registrado')
    await page.keyboard.press('Escape')
    await expect(payments).toBeHidden()

    await goToSection(page, 'Clientes')
    await page.getByRole('link', { name: 'Ana Pérez' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Ana Pérez' })).toBeVisible()
    const entry = page
      .getByRole('list', { name: 'Historial de citas' })
      .getByRole('listitem')
      .filter({ hasText: `${FIXED_TODAY} 10:00` })
    await expect(entry).toHaveCount(1)
    await expect(entry).toContainText(`${MASSAGE} · Cabina 1`)
    await expect(entry).toContainText('Programada')
    const paid = entry.getByRole('group', { name: 'Pagos registrados' })
    await expect(paid).toContainText(/40,00/)
    await expect(paid.locator('[data-voided="false"]')).toHaveCount(1)
  })
})
