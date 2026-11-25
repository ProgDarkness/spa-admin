import type {
  AmountsByCurrency,
  AppointmentCounts,
  AppointmentStatus,
  AppointmentSummary,
  MonthlyMetrics,
  PaymentSummary,
} from '@/lib/bindings'
import type { SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import { internalError, validationError } from './ipc-errors'
import { isRecord, requirePermission } from './record-backend-support'
import type { SharedRows } from './shared-rows'

export type MetricsBackendOptions = {
  session: () => SessionUser | null
  appointments: SharedRows<AppointmentSummary>
  payments: SharedRows<PaymentSummary>
}

type MonthBounds = { start: string; end: string }

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/
const FIRST_YEAR = 1
const LAST_YEAR = 9998
const MONTHS_PER_YEAR = 12
const NON_COMPLETED_COLLECTED: readonly AppointmentStatus[] = ['cancelled', 'noShow']
const PENDING: readonly AppointmentStatus[] = ['scheduled', 'inProgress']

function firstMinuteOf(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01T00:00`
}

function monthBounds(month: string): MonthBounds {
  const match = MONTH_PATTERN.exec(month)
  const year = match ? Number(match[1]) : 0
  if (!match || year < FIRST_YEAR || year > LAST_YEAR) throw validationError('month')
  const number = Number(match[2])
  const rollsOver = number === MONTHS_PER_YEAR
  return {
    start: firstMinuteOf(year, number),
    end: firstMinuteOf(rollsOver ? year + 1 : year, rollsOver ? 1 : number + 1),
  }
}

function monthArgument(args: unknown): string {
  const value = isRecord(args) ? args.month : undefined
  if (typeof value !== 'string') throw new Error('argumento inválido: month')
  return value
}

function emptyAmounts(): AmountsByCurrency {
  return { USD: 0, VES: 0 }
}

function addSafely(total: number, addend: number): number {
  const sum = total + addend
  if (!Number.isSafeInteger(sum)) throw internalError()
  return sum
}

function inRange(appointment: AppointmentSummary, bounds: MonthBounds): boolean {
  return appointment.startsAt >= bounds.start && appointment.startsAt < bounds.end
}

function countByStatus(inMonth: readonly AppointmentSummary[]): AppointmentCounts {
  const counts: AppointmentCounts = { scheduled: 0, inProgress: 0, completed: 0, cancelled: 0, noShow: 0 }
  inMonth.forEach((appointment) => {
    counts[appointment.status] += 1
  })
  return counts
}

function clientTurnover(
  appointments: readonly AppointmentSummary[],
  inMonth: readonly AppointmentSummary[],
  bounds: MonthBounds,
): Pick<MonthlyMetrics, 'newClients' | 'recurringClients'> {
  const activeClients = new Set(inMonth.filter((row) => row.status === 'completed').map((row) => row.clientId))
  const returning = new Set(
    appointments.filter((row) => row.status === 'completed' && row.startsAt < bounds.start).map((row) => row.clientId),
  )
  const recurringClients = [...activeClients].filter((clientId) => returning.has(clientId)).length
  return { newClients: activeClients.size - recurringClients, recurringClients }
}

function amountsOf(
  inMonth: readonly AppointmentSummary[],
  payments: readonly PaymentSummary[],
  statuses: readonly AppointmentStatus[],
): AmountsByCurrency {
  const ids = new Set(inMonth.filter((row) => statuses.includes(row.status)).map((row) => row.id))
  return payments
    .filter((payment) => payment.voidedAt === null && ids.has(payment.appointmentId))
    .reduce((totals, payment) => ({ ...totals, [payment.currency]: addSafely(totals[payment.currency], payment.amountCents) }), emptyAmounts())
}

export function createMetricsIpcBackend(next: IpcBackend, options: MetricsBackendOptions): IpcBackend {
  function getMonthlyMetrics(args: unknown): MonthlyMetrics {
    requirePermission(options.session, 'metrics.read')
    const month = monthArgument(args)
    const bounds = monthBounds(month)
    const appointments = options.appointments.read()
    const payments = options.payments.read()
    const inMonth = appointments.filter((row) => inRange(row, bounds))
    return {
      month,
      ...clientTurnover(appointments, inMonth, bounds),
      appointments: countByStatus(inMonth),
      revenueByCurrency: amountsOf(inMonth, payments, ['completed']),
      collectedOnNonCompletedByCurrency: amountsOf(inMonth, payments, NON_COMPLETED_COLLECTED),
      pendingByCurrency: amountsOf(inMonth, payments, PENDING),
    }
  }

  return (cmd, args) => (cmd === 'get_monthly_metrics' ? getMonthlyMetrics(args) : next(cmd, args))
}
