import { monthOf } from '@/lib/datetime'
import type {
  AmountsByCurrency,
  Appointment,
  AppointmentCounts,
  Id,
  MonthlyMetrics,
  Payment,
  YearMonth,
} from '@/lib/model'
import { addAmount, emptyAmounts } from '@/lib/money'

const EMPTY_COUNTS: AppointmentCounts = { scheduled: 0, inProgress: 0, completed: 0, cancelled: 0, noShow: 0 }
const COUNTED_STATUSES = ['scheduled', 'inProgress', 'completed', 'cancelled', 'noShow'] as const

type ClientTurnover = Pick<MonthlyMetrics, 'newClients' | 'recurringClients'>

function countByStatus(inMonth: readonly Appointment[]): AppointmentCounts {
  return COUNTED_STATUSES.reduce(
    (counts, status) => ({ ...counts, [status]: inMonth.filter((row) => row.status === status).length }),
    EMPTY_COUNTS,
  )
}

function firstCompletedMonthByClient(completed: readonly Appointment[]): Map<Id, YearMonth> {
  const firstStartByClient = new Map<Id, string>()
  for (const row of completed) {
    const known = firstStartByClient.get(row.clientId)
    if (known === undefined || row.startsAt < known) firstStartByClient.set(row.clientId, row.startsAt)
  }
  return new Map([...firstStartByClient].map(([clientId, startsAt]) => [clientId, monthOf(startsAt)]))
}

function clientTurnover(month: YearMonth, completed: readonly Appointment[]): ClientTurnover {
  const firstMonths = firstCompletedMonthByClient(completed)
  const activeClients = new Set(
    completed.filter((row) => monthOf(row.startsAt) === month).map((row) => row.clientId),
  )
  const recurring = [...activeClients].filter((clientId) => (firstMonths.get(clientId) ?? month) < month)
  return {
    newClients: activeClients.size - recurring.length,
    recurringClients: recurring.length,
  }
}

function sumActiveByCurrency(payments: readonly Payment[]): AmountsByCurrency {
  return payments
    .filter((payment) => payment.voidedAt === null)
    .reduce((totals, payment) => addAmount(totals, payment.currency, payment.amountCents), emptyAmounts())
}

function paymentsOfAppointments(appointments: readonly Appointment[], payments: readonly Payment[]): Payment[] {
  const ids = new Set(appointments.map((row) => row.id))
  return payments.filter((payment) => ids.has(payment.appointmentId))
}

export function computeMonthlyMetrics(
  month: YearMonth,
  appointments: readonly Appointment[],
  payments: readonly Payment[],
): MonthlyMetrics {
  const inMonth = appointments.filter((row) => monthOf(row.startsAt) === month)
  const completedAll = appointments.filter((row) => row.status === 'completed')
  const completedInMonth = inMonth.filter((row) => row.status === 'completed')
  const notCompleted = inMonth.filter((row) => row.status === 'cancelled' || row.status === 'noShow')
  return {
    month,
    ...clientTurnover(month, completedAll),
    appointments: countByStatus(inMonth),
    revenueByCurrency: sumActiveByCurrency(paymentsOfAppointments(completedInMonth, payments)),
    collectedOnNonCompletedByCurrency: sumActiveByCurrency(paymentsOfAppointments(notCompleted, payments)),
  }
}
