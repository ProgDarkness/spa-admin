import type { AppError, AppointmentStatus, Client, Id, LocalDateTime, Resource, Service } from '@/lib/model'

const TIME_START_INDEX = 'YYYY-MM-DDT'.length

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Programada',
  inProgress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
  noShow: 'No asistió',
}

export type AppointmentLabels = {
  clientNameOf(id: Id): string
  serviceNameOf(id: Id): string
  resourceNameOf(id: Id): string
}

function nameLookup<T extends { id: Id }>(rows: readonly T[], nameOf: (row: T) => string, fallback: string) {
  const namesById = new Map(rows.map((row) => [row.id, nameOf(row)]))
  return (id: Id) => namesById.get(id) ?? fallback
}

export function buildAppointmentLabels(
  clients: readonly Client[],
  services: readonly Service[],
  resources: readonly Resource[],
): AppointmentLabels {
  return {
    clientNameOf: nameLookup(clients, (client) => `${client.firstName} ${client.lastName}`, 'Cliente'),
    serviceNameOf: nameLookup(services, (service) => service.name, 'Servicio'),
    resourceNameOf: nameLookup(resources, (resource) => resource.name, 'Recurso'),
  }
}

export function timeOf(dateTime: LocalDateTime): string {
  return dateTime.slice(TIME_START_INDEX)
}

export function fieldErrorOf(failure: AppError | null, formFields: readonly string[]): string | null {
  if (!failure?.field) return null
  return formFields.includes(failure.field) ? failure.field : null
}
