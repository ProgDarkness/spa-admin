import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Appointment, AppointmentInput, Id, Result } from '@/lib/model'
import { freezeDate } from './clock'

export const NOW = '2026-11-12T09:00'
export const DAY = '2026-11-13'
export const CABIN_ONE = 1
export const CABIN_TWO = 2
export const INACTIVE_MANICURE = 3
export const ACTIVE_CLIENT = 1
export const OTHER_CLIENT = 2
export const DELETED_CLIENT = 9
export const FACIAL_SERVICE_ID = 1
export const FACIAL_PRICE_CENTS = 3_500
export const FACIAL_DURATION_MIN = 60
export const BROW_SERVICE_ID = 3
export const INACTIVE_SERVICE = 8
export const MISSING_ID = 999

export function resetWithEmptyAgenda(): void {
  freezeDate(NOW)
  resetStore()
  commit({ ...getState(), appointments: [] })
}

export function appointmentTemplate(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 100,
    clientId: OTHER_CLIENT,
    serviceId: FACIAL_SERVICE_ID,
    resourceId: CABIN_ONE,
    startsAt: `${DAY}T10:00`,
    endsAt: `${DAY}T11:00`,
    status: 'scheduled',
    priceCentsSnapshot: FACIAL_PRICE_CENTS,
    durationMinSnapshot: FACIAL_DURATION_MIN,
    notes: null,
    ...overrides,
  }
}

export function seedAppointments(...rows: Appointment[]): void {
  commit({ ...getState(), appointments: rows })
}

export function inputTemplate(overrides: Partial<AppointmentInput> = {}): AppointmentInput {
  return {
    clientId: ACTIVE_CLIENT,
    serviceId: FACIAL_SERVICE_ID,
    resourceId: CABIN_ONE,
    startsAt: `${DAY}T12:00`,
    notes: null,
    ...overrides,
  }
}

export function errorOf<T>(result: Result<T>) {
  if (result.status !== 'error') throw new Error('Se esperaba un error')
  return result.error
}

export function dataOf<T>(result: Result<T>): T {
  if (result.status !== 'ok') throw new Error(`Se esperaba ok y llegó ${result.error.code}`)
  return result.data
}

export function appointmentById(id: Id): Appointment {
  const found = getState().appointments.find((row) => row.id === id)
  if (!found) throw new Error(`Cita inexistente ${id}`)
  return found
}
