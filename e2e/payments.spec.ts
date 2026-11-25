import { expect, test, type Page } from '@playwright/test'
import { allAppointments, invokeCommand } from './support/appointments'
import {
  closePaymentsDialog,
  historyEntry,
  historySummary,
  openClientHistory,
  openEntryPayments,
  registerPayment,
  submitPayment,
  type PaymentRecord,
} from './support/payments'
import { signInAs } from './support/session'

const MISSING_RATE_DAY = new Date('2026-11-20T09:00:00-04:00')
const MISSING_RATE_BANNER = /Falta la tasa de cambio de hoy/
const MISSING_RATE_FIELD_MESSAGE = 'Falta la tasa de hoy; registra la tasa o indícala manualmente'
const FORBIDDEN_ERROR = { code: 'forbidden', message: 'No tienes permiso para esta acción' }
const VOID_REASON = 'Cobro duplicado por error'
const SEED_PAYMENT_COUNT = 11
const SCHEDULED_ENTRY = '2026-11-13 16:00'
const CANCELLED_ENTRY = '2026-10-20 12:00'
const MARIA_COMPLETED_ENTRY = '2026-11-01 14:00'
const SCHEDULED_APPOINTMENT_ID = 5
const FIRST_SEED_PAYMENT_ID = 1

async function paymentsOf(page: Page, appointmentId: number): Promise<PaymentRecord[]> {
  const outcome = (await invokeCommand(page, 'list_payments', { appointmentId })) as {
    resolved: boolean
    value: PaymentRecord[]
  }
  expect(outcome.resolved).toBe(true)
  return outcome.value
}

async function allPayments(page: Page): Promise<PaymentRecord[]> {
  const appointments = await allAppointments(page)
  const perAppointment = await Promise.all(appointments.map((appointment) => paymentsOf(page, appointment.id)))
  return perAppointment.flat().toSorted((first, second) => first.id - second.id)
}

test.describe('propietaria: registro de pagos', () => {
  test('en VES usa la tasa del día por defecto y al editarla a mano cambia el equivalente en USD con redondeo half-up', async ({
    page,
  }) => {
    await signInAs(page, 'propietaria')
    await openClientHistory(page, 'Luis Martínez')
    const dialog = await openEntryPayments(page, SCHEDULED_ENTRY)
    await expect(dialog.getByText('Esta cita aún no tiene pagos.')).toBeVisible()

    await dialog.getByLabel('Moneda').selectOption({ label: 'Bolívares (VES)' })
    await expect(dialog.getByLabel('Tasa (Bs por USD)')).toHaveValue('36,50')
    await registerPayment(page, { method: 'Pago móvil', currency: 'Bolívares (VES)', amount: '1000,00' })

    const defaultRatePayment = dialog.getByRole('listitem').filter({ hasText: 'Pago móvil' })
    await expect(defaultRatePayment).toContainText('Tasa 36,50')
    await expect(defaultRatePayment).toContainText(/≈\s*\S*\s*27,40/)

    await dialog.getByLabel('Monto').fill('100,20')
    await dialog.getByLabel('Tasa (Bs por USD)').fill('40,00')
    await dialog.getByRole('button', { name: 'Registrar pago' }).click()

    const manualRatePayment = dialog.getByRole('listitem').filter({ hasText: 'Tasa 40,00' })
    await expect(manualRatePayment).toContainText(/≈\s*\S*\s*2,51/)
    await expect(dialog.getByRole('group', { name: 'Totales cobrados' })).toContainText(/Total equivalente en USD:\s*\S*\s*29,91/)

    const stored = await paymentsOf(page, SCHEDULED_APPOINTMENT_ID)
    expect(stored).toMatchObject([
      { currency: 'VES', amountCents: 100_000, rateBsPerUsdE4: 365_000, usdEquivalentCents: 2_740 },
      { currency: 'VES', amountCents: 10_020, rateBsPerUsdE4: 400_000, usdEquivalentCents: 251 },
    ])
  })

  test('en VES sin tasa del día el pago es rechazado con el error en el campo y no se guarda nada', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: MISSING_RATE_DAY })
    await expect(page.getByRole('alert').filter({ hasText: MISSING_RATE_BANNER })).toBeVisible()
    await openClientHistory(page, 'Luis Martínez')
    const dialog = await openEntryPayments(page, SCHEDULED_ENTRY)

    await dialog.getByLabel('Moneda').selectOption({ label: 'Bolívares (VES)' })
    await expect(dialog.getByLabel('Tasa (Bs por USD)')).toHaveValue('')
    await expect(dialog.getByRole('note')).toContainText('Falta la tasa de hoy. Ingresa la tasa manualmente')
    await submitPayment(page, { method: 'Pago móvil', currency: 'Bolívares (VES)', amount: '500,00' })

    await expect(dialog.getByText(MISSING_RATE_FIELD_MESSAGE)).toBeVisible()
    await expect(dialog.getByText('Pago registrado')).toHaveCount(0)
    await expect(dialog.getByText('Esta cita aún no tiene pagos.')).toBeVisible()
    expect(await allPayments(page)).toHaveLength(SEED_PAYMENT_COUNT)
  })

  test('en USD ignora la tasa aunque se haya elegido VES antes y guarda tasa nula', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await openClientHistory(page, 'Luis Martínez')
    const dialog = await openEntryPayments(page, SCHEDULED_ENTRY)

    await dialog.getByLabel('Moneda').selectOption({ label: 'Bolívares (VES)' })
    await expect(dialog.getByLabel('Tasa (Bs por USD)')).toHaveValue('36,50')
    await registerPayment(page, { method: 'Zelle', currency: 'Dólares (USD)', amount: '25,00' })

    const payment = dialog.getByRole('listitem').filter({ hasText: 'Zelle' })
    await expect(payment).toContainText(/25,00/)
    await expect(payment).not.toContainText('Tasa')
    await expect(dialog.getByLabel('Tasa (Bs por USD)')).toHaveCount(0)
    await expect(dialog.getByRole('group', { name: 'Totales cobrados' })).toContainText(/Total USD:\s*\S*\s*25,00/)

    expect(await paymentsOf(page, SCHEDULED_APPOINTMENT_ID)).toMatchObject([
      { currency: 'USD', amountCents: 2_500, rateBsPerUsdE4: null, usdEquivalentCents: 2_500 },
    ])
  })

  test('un pago en una cita cancelada se acepta y suma en cobros de citas no completadas', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await openClientHistory(page, 'Ana Pérez')
    await expect(historySummary(page)).toContainText(/Cobrado en citas no completadas en USD:\s*\S*\s*15,00/)
    await expect(historyEntry(page, CANCELLED_ENTRY)).toContainText('Cancelada')

    await openEntryPayments(page, CANCELLED_ENTRY)
    await registerPayment(page, { method: 'Efectivo', currency: 'Dólares (USD)', amount: '30,00' })
    await closePaymentsDialog(page)

    await expect(historyEntry(page, CANCELLED_ENTRY).getByRole('group', { name: 'Pagos registrados' })).toContainText(/30,00/)
    await expect(historySummary(page)).toContainText(/Cobrado en citas no completadas en USD:\s*\S*\s*45,00/)
    await expect(historySummary(page)).toContainText(/Pagado en USD:\s*\S*\s*0,00/)
  })

  test('una seña en una cita programada aparece en cobros pendientes y no en pagado', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await openClientHistory(page, 'Luis Martínez')
    await expect(historySummary(page)).toContainText(/Cobros pendientes \(citas programadas o en curso\) en USD:\s*\S*\s*0,00/)

    await openEntryPayments(page, SCHEDULED_ENTRY)
    await registerPayment(page, { method: 'Zelle', currency: 'Dólares (USD)', amount: '20,00' })
    await closePaymentsDialog(page)

    await expect(historySummary(page)).toContainText(/Cobros pendientes \(citas programadas o en curso\) en USD:\s*\S*\s*20,00/)
    await expect(historySummary(page)).toContainText(/Pagado en USD:\s*\S*\s*0,00/)
  })
})

test.describe('propietaria: anulación de pagos', () => {
  test('anular con motivo tacha el pago, lo muestra anulado y el total del historial deja de sumarlo', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await openClientHistory(page, 'María González')
    await expect(historySummary(page)).toContainText(/Pagado en USD:\s*\S*\s*55,00/)

    const dialog = await openEntryPayments(page, MARIA_COMPLETED_ENTRY)
    await dialog.getByRole('button', { name: /Anular pago de .*20,00/ }).click()
    const voiding = page.getByRole('dialog', { name: 'Anular pago' })
    await voiding.getByLabel('Motivo de la anulación').fill(VOID_REASON)
    await voiding.getByRole('button', { name: 'Confirmar anulación' }).click()
    await expect(voiding).toBeHidden()

    const voided = dialog.locator('[data-voided="true"]')
    await expect(voided).toHaveCount(1)
    await expect(voided).toContainText(`Anulado: ${VOID_REASON}`)
    await expect(voided.getByRole('deletion')).toContainText(/20,00/)
    await expect(dialog.getByRole('group', { name: 'Totales cobrados' })).toContainText(/Total USD:\s*\S*\s*0,00/)
    await closePaymentsDialog(page)

    await expect(historySummary(page)).toContainText(/Pagado en USD:\s*\S*\s*35,00/)
    await expect(historySummary(page)).toContainText(/Pagado en VES:\s*\S*\s*730,00/)
  })

  test('un motivo vacío se rechaza en el campo y el pago sigue vigente', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await openClientHistory(page, 'María González')
    const dialog = await openEntryPayments(page, MARIA_COMPLETED_ENTRY)

    await dialog.getByRole('button', { name: /Anular pago de .*20,00/ }).click()
    const voiding = page.getByRole('dialog', { name: 'Anular pago' })
    await voiding.getByLabel('Motivo de la anulación').fill('   ')
    await voiding.getByRole('button', { name: 'Confirmar anulación' }).click()

    await expect(voiding.getByText('Indica el motivo de la anulación')).toBeVisible()
    await expect(voiding).toBeVisible()
    const stored = await allPayments(page)
    expect(stored.filter((payment) => payment.voidedAt !== null)).toHaveLength(1)
  })

  test('anular dos veces el mismo pago por IPC se rechaza con alreadyVoided y conserva el primer motivo', async ({ page }) => {
    await signInAs(page, 'propietaria')

    const first = await invokeCommand(page, 'void_payment', { request: { id: FIRST_SEED_PAYMENT_ID, reason: VOID_REASON } })
    expect(first).toMatchObject({ resolved: true, value: { id: FIRST_SEED_PAYMENT_ID, voidReason: VOID_REASON } })

    const second = await invokeCommand(page, 'void_payment', { request: { id: FIRST_SEED_PAYMENT_ID, reason: 'Otro motivo' } })
    expect(second).toEqual({
      resolved: false,
      payload: expect.objectContaining({ code: 'alreadyVoided', entityIds: [FIRST_SEED_PAYMENT_ID] }),
    })
    const stored = (await allPayments(page)).find((payment) => payment.id === FIRST_SEED_PAYMENT_ID)
    expect(stored?.voidReason).toBe(VOID_REASON)
  })
})

test.describe('solo lectura: pagos', () => {
  test('ve los pagos sin formulario ni anulación y las mutaciones por IPC dan forbidden sin alterar datos', async ({ page }) => {
    await signInAs(page, 'lectura')
    await openClientHistory(page, 'María González')
    const dialog = await openEntryPayments(page, MARIA_COMPLETED_ENTRY)

    await expect(dialog.getByRole('listitem').filter({ hasText: 'Zelle' })).toContainText(/20,00/)
    await expect(dialog.getByRole('button', { name: /Registrar pago|Anular pago/ })).toHaveCount(0)
    await expect(dialog.getByLabel('Monto')).toHaveCount(0)
    await closePaymentsDialog(page)

    const before = await allPayments(page)
    const denied = { resolved: false, payload: expect.objectContaining(FORBIDDEN_ERROR) }
    expect(
      await invokeCommand(page, 'create_payment', {
        input: { appointmentId: SCHEDULED_APPOINTMENT_ID, methodId: 1, currency: 'USD', amountCents: 100, rateBsPerUsdE4: null },
      }),
    ).toEqual(denied)
    expect(await invokeCommand(page, 'void_payment', { request: { id: FIRST_SEED_PAYMENT_ID, reason: 'Intruso' } })).toEqual(denied)

    expect(await allPayments(page)).toEqual(before)
  })
})

test.describe('historial del cliente: totales', () => {
  test('el tiempo total cuenta solo citas completadas y los pagos se totalizan por moneda', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await openClientHistory(page, 'María González')

    const summary = historySummary(page)
    await expect(summary).toContainText('Tiempo total en servicios completados: 2 h')
    await expect(summary).not.toContainText('2 h 30 min')
    await expect(summary).toContainText(/Pagado en USD:\s*\S*\s*55,00/)
    await expect(summary).toContainText(/Pagado en VES:\s*\S*\s*730,00/)
    await expect(summary).toContainText(/Equivalente en USD de pagos en VES:\s*\S*\s*20,00/)
    await expect(summary).toContainText(/Cobrado en citas no completadas en USD:\s*\S*\s*0,00/)
    await expect(summary).toContainText(/Cobros pendientes \(citas programadas o en curso\) en VES:\s*\S*\s*0,00/)
  })

  test('el pago anulado del seed no suma en los totales de José Rodríguez', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await openClientHistory(page, 'José Rodríguez')

    const summary = historySummary(page)
    await expect(summary).toContainText('Tiempo total en servicios completados: 3 h')
    await expect(summary).toContainText(/Pagado en USD:\s*\S*\s*75,00/)
    await expect(summary).toContainText(/Pagado en VES:\s*\S*\s*1\.825,00/)
    await expect(summary).toContainText(/Equivalente en USD de pagos en VES:\s*\S*\s*50,00/)
    await expect(page.locator('[data-voided="true"]')).toHaveCount(1)
  })
})
