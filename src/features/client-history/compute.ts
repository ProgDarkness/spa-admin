import { sumActivePayments, usdTotalOfActivePayments } from '@/features/payments/domain'
import type {
  AmountsByCurrency,
  Appointment,
  AppointmentStatus,
  Cents,
  Client,
  ClientHistory,
  ClientHistoryEntry,
  Id,
  Payment,
  Resource,
  Service,
} from '@/lib/model'

const FALLBACK_SERVICE_NAME = 'Servicio'
const FALLBACK_RESOURCE_NAME = 'Recurso'
const UNCOLLECTED_STATUSES: readonly AppointmentStatus[] = ['cancelled', 'noShow']

export type ClientHistorySource = {
  client: Client
  appointments: readonly Appointment[]
  payments: readonly Payment[]
  services: readonly Service[]
  resources: readonly Resource[]
}

function namesById<T extends { id: Id; name: string }>(rows: readonly T[]): Map<Id, string> {
  return new Map(rows.map((row) => [row.id, row.name]))
}

function paymentsByAppointment(payments: readonly Payment[]): Map<Id, Payment[]> {
  return payments.reduce((grouped, payment) => {
    const bucket = grouped.get(payment.appointmentId) ?? []
    return grouped.set(payment.appointmentId, [...bucket, payment])
  }, new Map<Id, Payment[]>())
}

function totalsOf(entries: readonly ClientHistoryEntry[], statuses: readonly AppointmentStatus[]): AmountsByCurrency {
  const payments = entries.filter((entry) => statuses.includes(entry.status)).flatMap((entry) => entry.payments)
  return sumActivePayments(payments)
}

function completedMinutesOf(entries: readonly ClientHistoryEntry[]): number {
  return entries
    .filter((entry) => entry.status === 'completed')
    .reduce((total, entry) => total + entry.durationMinSnapshot, 0)
}

export function buildClientHistory(source: ClientHistorySource): ClientHistory {
  const serviceNames = namesById(source.services)
  const resourceNames = namesById(source.resources)
  const grouped = paymentsByAppointment(source.payments)
  const entries: ClientHistoryEntry[] = source.appointments
    .filter((appointment) => appointment.clientId === source.client.id)
    .toSorted((first, second) => second.startsAt.localeCompare(first.startsAt) || second.id - first.id)
    .map((appointment) => ({
      ...appointment,
      serviceName: serviceNames.get(appointment.serviceId) ?? FALLBACK_SERVICE_NAME,
      resourceName: resourceNames.get(appointment.resourceId) ?? FALLBACK_RESOURCE_NAME,
      payments: grouped.get(appointment.id) ?? [],
    }))
  return {
    client: source.client,
    entries,
    totalMinutes: completedMinutesOf(entries),
    paidByCurrency: totalsOf(entries, ['completed']),
    collectedOnNonCompletedByCurrency: totalsOf(entries, UNCOLLECTED_STATUSES),
  }
}

export function vesUsdEquivalentOfCompleted(entries: readonly ClientHistoryEntry[]): Cents {
  const vesPayments = entries
    .filter((entry) => entry.status === 'completed')
    .flatMap((entry) => entry.payments)
    .filter((payment) => payment.currency === 'VES')
  return usdTotalOfActivePayments(vesPayments)
}
