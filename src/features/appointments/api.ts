import { commands, type AppointmentSummary } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import type {
  Appointment,
  AppointmentInput,
  AppointmentMove,
  AppointmentRange,
  AppointmentTransition,
  Id,
  Result,
} from '@/lib/model'
import { mapOk } from '@/lib/result'

function toAppointment(summary: AppointmentSummary): Appointment {
  return {
    id: summary.id,
    clientId: summary.clientId,
    serviceId: summary.serviceId,
    resourceId: summary.resourceId,
    startsAt: summary.startsAt,
    endsAt: summary.endsAt,
    status: summary.status,
    priceCentsSnapshot: summary.priceCentsSnapshot,
    durationMinSnapshot: summary.durationMinSnapshot,
    notes: summary.notes,
  }
}

export function listAppointments(range: AppointmentRange): Promise<Result<Appointment[]>> {
  return settle(async () => mapOk(await commands.listAppointments(range), (rows) => rows.map(toAppointment)))
}

function callAppointmentBackend(operation: () => Promise<Result<AppointmentSummary>>): Promise<Result<Appointment>> {
  return settle(async () => mapOk(await operation(), toAppointment))
}

export function createAppointment(input: AppointmentInput): Promise<Result<Appointment>> {
  return callAppointmentBackend(() => commands.createAppointment(input))
}

export function moveAppointment(id: Id, move: AppointmentMove): Promise<Result<Appointment>> {
  return callAppointmentBackend(() => commands.moveAppointment({ id, ...move }))
}

export function transitionAppointment(id: Id, transition: AppointmentTransition): Promise<Result<Appointment>> {
  return callAppointmentBackend(() => commands.transitionAppointment({ id, transition }))
}
