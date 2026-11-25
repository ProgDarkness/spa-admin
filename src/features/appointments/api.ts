import { commands, type AppointmentSummary } from '@/lib/bindings'
import { callBackend, settle } from '@/lib/ipc'
import { createMirrorSync } from '@/lib/mirror-sync'
import { commit, getState, upsertById } from '@/lib/mock/store'
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

const mirrorSync = createMirrorSync()

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

function replaceAppointments(appointments: readonly Appointment[]): void {
  commit({ ...getState(), appointments })
}

function mirrorAppointment(appointment: Appointment): void {
  const state = getState()
  commit({ ...state, appointments: upsertById(state.appointments, appointment) })
}

export function listAppointments(range: AppointmentRange): Promise<Result<Appointment[]>> {
  return settle(async () => mapOk(await commands.listAppointments(range), (rows) => rows.map(toAppointment)))
}

function fetchAllAppointments(): Promise<Result<Appointment[]>> {
  return settle(async () => mapOk(await commands.listAllAppointments(), (rows) => rows.map(toAppointment)))
}

function callAppointmentBackend(operation: () => Promise<Result<AppointmentSummary>>): Promise<Result<Appointment>> {
  return callBackend(
    async () => mapOk(await operation(), toAppointment),
    mirrorSync.reflectMutation(mirrorAppointment),
  )
}

export function syncAppointmentsMirror(): Promise<Result<Appointment[]>> {
  return mirrorSync.listUntilApplied(fetchAllAppointments, replaceAppointments)
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
