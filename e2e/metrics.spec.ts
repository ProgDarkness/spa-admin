import { expect, test, type Locator, type Page } from '@playwright/test'
import type { MonthlyMetrics } from '../src/lib/bindings'
import {
  actionButton,
  allAppointments,
  bookAppointment,
  invokeCommand,
  type AppointmentDraft,
  type AppointmentRecord,
} from './support/appointments'
import { openClientHistory, openEntryPayments, closePaymentsDialog, registerPayment, type PaymentRecord } from './support/payments'
import { FIXED_TODAY, goToSection, mainNavigation, signInAs } from './support/session'

type Currency = 'USD' | 'VES'
type Amounts = Readonly<Record<Currency, string>>
type Counters = Readonly<{
  newClients: number
  recurringClients: number
  scheduled: number
  inProgress: number
  completed: number
  cancelled: number
  noShow: number
}>

const FACIAL = 'Limpieza facial (ejemplo)'
const FORBIDDEN_ERROR = { code: 'forbidden', message: 'No tienes permiso para esta acción' }
const CLOCK = new Date(`${FIXED_TODAY}T10:00:00-04:00`)
const DECEMBER_CLOCK = new Date('2026-12-03T10:00:00-04:00')
const NOVEMBER = '2026-11'
const OCTOBER = '2026-10'
const ENTRY_START = `${FIXED_TODAY} 10:00`
const REVENUE = 'Ingreso del mes'
const NON_COMPLETED = 'Cobros en citas no completadas'
const PENDING = 'Cobrado por adelantado (citas pendientes)'
const SEED_VOIDABLE_USD_20_PAYMENT_ID = 3
const NOVEMBER_APPOINTMENT_WITHOUT_PAYMENTS = 16
const OCTOBER_COMPLETED_APPOINTMENT = 1

const COUNTER_LABELS: Readonly<Record<keyof Counters, string>> = {
  newClients: 'Clientes nuevos',
  recurringClients: 'Clientes recurrentes',
  scheduled: 'Programadas',
  inProgress: 'En curso',
  completed: 'Completadas',
  cancelled: 'Canceladas',
  noShow: 'No asistió',
}

const NOVEMBER_COUNTERS: Counters = {
  newClients: 1,
  recurringClients: 2,
  scheduled: 2,
  inProgress: 1,
  completed: 3,
  cancelled: 1,
  noShow: 1,
}
const NOVEMBER_REVENUE: Amounts = { USD: '80,00', VES: '730,00' }
const NOVEMBER_NON_COMPLETED: Amounts = { USD: '15,00', VES: '0,00' }
const NO_AMOUNTS: Amounts = { USD: '0,00', VES: '0,00' }
const OCTOBER_COUNTERS: Counters = {
  newClients: 4,
  recurringClients: 0,
  scheduled: 0,
  inProgress: 0,
  completed: 6,
  cancelled: 1,
  noShow: 1,
}
const OCTOBER_REVENUE: Amounts = { USD: '205,00', VES: '2.555,00' }
const OCTOBER_NON_COMPLETED: Amounts = { USD: '0,00', VES: '0,00' }

function draft(client: string, time: string): AppointmentDraft {
  return { client, service: FACIAL, resource: 'Cabina 1', startsAt: `${FIXED_TODAY}T${time}` }
}

function moneyText(figure: string): RegExp {
  return new RegExp(`^[^\\d]*${figure.replaceAll('.', '\\.')}$`)
}

function counter(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator('xpath=following-sibling::dd')
}

function amountOf(page: Page, heading: string, currency: Currency): Locator {
  return page.getByRole('region', { name: heading }).getByText(currency, { exact: true }).locator('xpath=following-sibling::dd')
}

async function expectAmounts(page: Page, heading: string, expected: Amounts): Promise<void> {
  await expect(amountOf(page, heading, 'USD')).toHaveText(moneyText(expected.USD))
  await expect(amountOf(page, heading, 'VES')).toHaveText(moneyText(expected.VES))
}

async function expectCounters(page: Page, expected: Counters): Promise<void> {
  for (const key of Object.keys(COUNTER_LABELS) as (keyof Counters)[]) {
    await expect(counter(page, COUNTER_LABELS[key])).toHaveText(String(expected[key]))
  }
}

async function expectMonth(page: Page, month: string, counters: Counters, revenue: Amounts, nonCompleted: Amounts, pending: Amounts) {
  await expect(page.getByLabel('Mes', { exact: true })).toHaveValue(month)
  await expectCounters(page, counters)
  await expectAmounts(page, REVENUE, revenue)
  await expectAmounts(page, NON_COMPLETED, nonCompleted)
  await expectAmounts(page, PENDING, pending)
}

async function openMetrics(page: Page): Promise<void> {
  await goToSection(page, 'Métricas')
  await expect(page.getByRole('region', { name: REVENUE })).toBeVisible()
}

async function ipc<T>(page: Page, command: string, args: unknown): Promise<T> {
  const outcome = (await invokeCommand(page, command, args)) as { resolved: boolean; value: T }
  expect(outcome.resolved).toBe(true)
  return outcome.value
}

async function paymentsOf(page: Page, appointmentId: number): Promise<PaymentRecord[]> {
  return ipc<PaymentRecord[]>(page, 'list_payments', { appointmentId })
}

async function monthlyMetrics(page: Page, month: string): Promise<MonthlyMetrics> {
  return ipc<MonthlyMetrics>(page, 'get_monthly_metrics', { month })
}

async function appointmentsIn(page: Page, from: string, to: string): Promise<AppointmentRecord[]> {
  return ipc<AppointmentRecord[]>(page, 'list_appointments', { range: { from, to, resourceId: null } })
}

async function liveRevenueCents(page: Page, month: string, currency: Currency): Promise<number> {
  const rows = await appointmentsIn(page, `${month}-01`, `${month}-30`)
  const completed = rows.filter((row) => row.status === 'completed')
  const payments = (await Promise.all(completed.map((row) => paymentsOf(page, row.id)))).flat()
  return payments
    .filter((payment) => payment.voidedAt === null && payment.currency === currency)
    .reduce((sum, payment) => sum + payment.amountCents, 0)
}

async function createPaymentByIpc(page: Page, appointmentId: number, amountCents: number): Promise<void> {
  await ipc(page, 'create_payment', {
    input: { appointmentId, methodId: 1, currency: 'USD', amountCents, rateBsPerUsdE4: null },
  })
}

async function payFromHistory(page: Page, client: string, payment: { currency: 'Dólares (USD)' | 'Bolívares (VES)'; amount: string }) {
  await openClientHistory(page, client)
  await openEntryPayments(page, ENTRY_START)
  await registerPayment(page, { method: 'Efectivo', ...payment })
  await closePaymentsDialog(page)
}

test.describe('propietaria: métricas del mes', () => {
  test('el mes del seed muestra ingreso por moneda, conteos por estado y clientes nuevos y recurrentes exactos', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: CLOCK })

    const monthRows = await appointmentsIn(page, '2026-11-01', '2026-11-30')
    const byStatus = (status: string) => monthRows.filter((row) => row.status === status).length
    expect({
      scheduled: byStatus('scheduled'),
      inProgress: byStatus('inProgress'),
      completed: byStatus('completed'),
      cancelled: byStatus('cancelled'),
      noShow: byStatus('noShow'),
    }).toEqual({ scheduled: 2, inProgress: 1, completed: 3, cancelled: 1, noShow: 1 })
    expect(await liveRevenueCents(page, NOVEMBER, 'USD')).toBe(8_000)
    expect(await liveRevenueCents(page, NOVEMBER, 'VES')).toBe(73_000)
    const completedClients = new Set(monthRows.filter((row) => row.status === 'completed').map((row) => row.clientId))
    const priorRows = await appointmentsIn(page, '2026-01-01', '2026-10-31')
    const priorClients = new Set(priorRows.filter((row) => row.status === 'completed').map((row) => row.clientId))
    expect([...completedClients].filter((id) => priorClients.has(id))).toHaveLength(2)
    expect([...completedClients].filter((id) => !priorClients.has(id))).toHaveLength(1)

    await openMetrics(page)

    await expectMonth(page, NOVEMBER, NOVEMBER_COUNTERS, NOVEMBER_REVENUE, NOVEMBER_NON_COMPLETED, NO_AMOUNTS)
    expect(await monthlyMetrics(page, NOVEMBER)).toMatchObject({
      newClients: 1,
      recurringClients: 2,
      appointments: { scheduled: 2, inProgress: 1, completed: 3, cancelled: 1, noShow: 1 },
      revenueByCurrency: { USD: 8_000, VES: 73_000 },
      collectedOnNonCompletedByCurrency: { USD: 1_500, VES: 0 },
      pendingByCurrency: { USD: 0, VES: 0 },
    })
  })

  for (const scenario of [
    { client: 'Gabriela Torres', kind: 'recurrente', counters: { ...NOVEMBER_COUNTERS, recurringClients: 3, completed: 4 } },
    { client: 'Sofía Ramírez', kind: 'nuevo', counters: { ...NOVEMBER_COUNTERS, newClients: 2, completed: 4 } },
  ]) {
    test(`una cita completada de un cliente ${scenario.kind} con pago USD 20,00 y VES 547,50 cambia ingreso, completadas y clientes`, async ({
      page,
    }) => {
      await signInAs(page, 'propietaria', { now: CLOCK })
      const card = await bookAppointment(page, draft(scenario.client, '10:00'))
      await actionButton(card, 'Completar', scenario.client).click()
      await expect(card).toContainText('Completada')
      await openClientHistory(page, scenario.client)
      await openEntryPayments(page, ENTRY_START)
      await registerPayment(page, { method: 'Efectivo', currency: 'Dólares (USD)', amount: '20,00' })
      await registerPayment(page, { method: 'Pago móvil', currency: 'Bolívares (VES)', amount: '547,50' })
      await closePaymentsDialog(page)

      await openMetrics(page)

      await expectMonth(
        page,
        NOVEMBER,
        scenario.counters,
        { USD: '100,00', VES: '1.277,50' },
        NOVEMBER_NON_COMPLETED,
        NO_AMOUNTS,
      )
      expect(await monthlyMetrics(page, NOVEMBER)).toMatchObject({
        revenueByCurrency: { USD: 10_000, VES: 127_750 },
        newClients: scenario.counters.newClients,
        recurringClients: scenario.counters.recurringClients,
      })
    })
  }

  test('una cancelada con seña USD 5,00 suma en cobros de citas no completadas y no en ingreso', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: CLOCK })
    const card = await bookAppointment(page, draft('Ana Pérez', '10:00'))
    await actionButton(card, 'Cancelar', 'Ana Pérez').click()
    await expect(card).toContainText('Cancelada')
    await payFromHistory(page, 'Ana Pérez', { currency: 'Dólares (USD)', amount: '5,00' })

    await openMetrics(page)

    await expectMonth(
      page,
      NOVEMBER,
      { ...NOVEMBER_COUNTERS, cancelled: 2 },
      NOVEMBER_REVENUE,
      { USD: '20,00', VES: '0,00' },
      NO_AMOUNTS,
    )
  })

  test('una programada con seña USD 5,00 aparece en cobrado por adelantado y no en ingreso', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: CLOCK })
    await bookAppointment(page, draft('Luis Martínez', '10:00'))
    await payFromHistory(page, 'Luis Martínez', { currency: 'Dólares (USD)', amount: '5,00' })

    await openMetrics(page)

    await expectMonth(
      page,
      NOVEMBER,
      { ...NOVEMBER_COUNTERS, scheduled: 3 },
      NOVEMBER_REVENUE,
      NOVEMBER_NON_COMPLETED,
      { USD: '5,00', VES: '0,00' },
    )
  })

  test('un pago anulado queda fuera del ingreso y el total baja', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: CLOCK })
    const voided = await ipc<PaymentRecord>(page, 'void_payment', {
      request: { id: SEED_VOIDABLE_USD_20_PAYMENT_ID, reason: 'Cobro duplicado por error' },
    })
    expect(voided).toMatchObject({ id: SEED_VOIDABLE_USD_20_PAYMENT_ID, amountCents: 2_000, currency: 'USD' })

    await openMetrics(page)

    await expectMonth(page, NOVEMBER, NOVEMBER_COUNTERS, { USD: '60,00', VES: '730,00' }, NOVEMBER_NON_COMPLETED, NO_AMOUNTS)
  })

  test('un pago cobrado en otro mes cuenta en el mes de la cita y no en el del cobro', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: DECEMBER_CLOCK })
    await createPaymentByIpc(page, NOVEMBER_APPOINTMENT_WITHOUT_PAYMENTS, 1_000)
    await createPaymentByIpc(page, OCTOBER_COMPLETED_APPOINTMENT, 500)
    const collected = (await ipc<{ paidAt: string }[]>(page, 'list_payments', { appointmentId: NOVEMBER_APPOINTMENT_WITHOUT_PAYMENTS }))[0]
    expect(collected?.paidAt.startsWith('2026-12-03')).toBe(true)

    await openMetrics(page)
    await expectMonth(
      page,
      '2026-12',
      { newClients: 0, recurringClients: 0, scheduled: 0, inProgress: 0, completed: 0, cancelled: 0, noShow: 0 },
      NO_AMOUNTS,
      NO_AMOUNTS,
      NO_AMOUNTS,
    )

    await page.getByRole('button', { name: 'Mes anterior' }).click()
    await expectMonth(page, NOVEMBER, NOVEMBER_COUNTERS, { USD: '90,00', VES: '730,00' }, NOVEMBER_NON_COMPLETED, NO_AMOUNTS)

    await page.getByRole('button', { name: 'Mes anterior' }).click()
    await expectMonth(page, OCTOBER, OCTOBER_COUNTERS, { USD: '210,00', VES: '2.555,00' }, OCTOBER_NON_COMPLETED, NO_AMOUNTS)
  })

  test('los botones de mes navegan entre meses con totales distintos y se deshabilitan en los extremos', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: CLOCK })
    await openMetrics(page)
    const previous = page.getByRole('button', { name: 'Mes anterior' })
    const next = page.getByRole('button', { name: 'Mes siguiente' })
    await expectMonth(page, NOVEMBER, NOVEMBER_COUNTERS, NOVEMBER_REVENUE, NOVEMBER_NON_COMPLETED, NO_AMOUNTS)

    await previous.click()
    await expectMonth(page, OCTOBER, OCTOBER_COUNTERS, OCTOBER_REVENUE, OCTOBER_NON_COMPLETED, NO_AMOUNTS)

    await next.click()
    await expectMonth(page, NOVEMBER, NOVEMBER_COUNTERS, NOVEMBER_REVENUE, NOVEMBER_NON_COMPLETED, NO_AMOUNTS)

    await next.click()
    await expectMonth(page, '2026-12', { ...OCTOBER_COUNTERS, newClients: 0, completed: 0, cancelled: 0, noShow: 0 }, NO_AMOUNTS, NO_AMOUNTS, NO_AMOUNTS)

    await page.getByLabel('Mes', { exact: true }).fill('0001-01')
    await expect(page.getByLabel('Mes', { exact: true })).toHaveValue('0001-01')
    await expect(previous).toBeDisabled()
    await expect(next).toBeEnabled()
    await page.getByLabel('Mes', { exact: true }).fill('9998-12')
    await expect(page.getByLabel('Mes', { exact: true })).toHaveValue('9998-12')
    await expect(next).toBeDisabled()
    await expect(previous).toBeEnabled()
  })
})

test.describe('permisos: métricas', () => {
  for (const username of ['recepcion', 'lectura'] as const) {
    test(`${username} no ve el enlace de Métricas y get_monthly_metrics por IPC da forbidden`, async ({ page }) => {
      await signInAs(page, username, { now: CLOCK })

      await expect(mainNavigation(page).getByRole('link', { name: 'Métricas' })).toHaveCount(0)
      expect(await invokeCommand(page, 'get_monthly_metrics', { month: NOVEMBER })).toEqual({
        resolved: false,
        payload: expect.objectContaining(FORBIDDEN_ERROR),
      })
      expect((await allAppointments(page)).length).toBeGreaterThan(0)
    })
  }

  test('la propietaria sí ve el enlace de Métricas', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: CLOCK })

    await expect(mainNavigation(page).getByRole('link', { name: 'Métricas' })).toHaveCount(1)
  })
})
