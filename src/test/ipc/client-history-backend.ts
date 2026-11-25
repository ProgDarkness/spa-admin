import type {
  AmountsByCurrency,
  AppointmentStatus,
  AppointmentSummary,
  ClientHistory,
  ClientHistoryEntry,
  ClientSummary,
  PaymentSummary,
  ResourceSummary,
  ServiceSummary,
} from '@/lib/bindings'
import type { SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import { internalError, notFoundError } from './ipc-errors'
import { isRecord, requirePermission } from './record-backend-support'
import type { SharedRows } from './shared-rows'

export type ClientHistoryBackendOptions = {
  session: () => SessionUser | null
  clients: SharedRows<ClientSummary>
  appointments: SharedRows<AppointmentSummary>
  services: SharedRows<ServiceSummary>
  resources: SharedRows<ResourceSummary>
  payments: SharedRows<PaymentSummary>
}

const REQUIRED_PERMISSIONS = ['clients.read', 'appointments.read', 'payments.read'] as const
const NON_COMPLETED_COLLECTED: readonly AppointmentStatus[] = ['cancelled', 'noShow']
const PENDING: readonly AppointmentStatus[] = ['scheduled', 'inProgress']

function emptyAmounts(): AmountsByCurrency {
  return { USD: 0, VES: 0 }
}

function newestFirst(first: AppointmentSummary, second: AppointmentSummary): number {
  return second.startsAt.localeCompare(first.startsAt) || second.id - first.id
}

function chronologically(first: PaymentSummary, second: PaymentSummary): number {
  return first.paidAt.localeCompare(second.paidAt) || first.id - second.id
}

function clientIdArgument(args: unknown): number {
  const value = isRecord(args) ? args.clientId : undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('argumento inválido: clientId')
  return value
}

function addSafely(total: number, addend: number): number {
  const sum = total + addend
  if (!Number.isSafeInteger(sum)) throw internalError()
  return sum
}

function amountsOf(entries: readonly ClientHistoryEntry[], statuses: readonly AppointmentStatus[]): AmountsByCurrency {
  return entries
    .filter((entry) => statuses.includes(entry.status))
    .flatMap((entry) => entry.payments)
    .filter((payment) => payment.voidedAt === null)
    .reduce((totals, payment) => ({ ...totals, [payment.currency]: addSafely(totals[payment.currency], payment.amountCents) }), emptyAmounts())
}

function vesEquivalentOfCompleted(entries: readonly ClientHistoryEntry[]): number {
  return entries
    .filter((entry) => entry.status === 'completed')
    .flatMap((entry) => entry.payments)
    .filter((payment) => payment.voidedAt === null && payment.currency === 'VES')
    .reduce((total, payment) => addSafely(total, payment.usdEquivalentCents), 0)
}

function completedMinutesOf(entries: readonly ClientHistoryEntry[]): number {
  return entries
    .filter((entry) => entry.status === 'completed')
    .reduce((total, entry) => addSafely(total, entry.durationMinSnapshot), 0)
}

export function createClientHistoryIpcBackend(next: IpcBackend, options: ClientHistoryBackendOptions): IpcBackend {
  function entryOf(
    appointment: AppointmentSummary,
    payments: readonly PaymentSummary[],
  ): ClientHistoryEntry | null {
    const service = options.services.read().find((row) => row.id === appointment.serviceId)
    const resource = options.resources.read().find((row) => row.id === appointment.resourceId)
    if (!service || !resource) return null
    return {
      ...appointment,
      serviceName: service.name,
      resourceName: resource.name,
      payments: payments.filter((payment) => payment.appointmentId === appointment.id).toSorted(chronologically),
    }
  }

  function getClientHistory(args: unknown): ClientHistory {
    REQUIRED_PERMISSIONS.forEach((permission) => requirePermission(options.session, permission))
    const clientId = clientIdArgument(args)
    const client = options.clients.read().find((row) => row.id === clientId)
    if (!client) throw notFoundError()
    const payments = options.payments.read()
    const entries = options.appointments
      .read()
      .filter((appointment) => appointment.clientId === clientId)
      .toSorted(newestFirst)
      .flatMap((appointment) => entryOf(appointment, payments) ?? [])
    return {
      client,
      entries,
      totalMinutes: completedMinutesOf(entries),
      paidByCurrency: amountsOf(entries, ['completed']),
      collectedOnNonCompletedByCurrency: amountsOf(entries, NON_COMPLETED_COLLECTED),
      pendingByCurrency: amountsOf(entries, PENDING),
      vesUsdEquivalentOfCompleted: vesEquivalentOfCompleted(entries),
    }
  }

  return (cmd, args) => (cmd === 'get_client_history' ? getClientHistory(args) : next(cmd, args))
}
