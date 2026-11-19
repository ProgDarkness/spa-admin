import { todayLocal } from '@/lib/datetime'
import type {
  Appointment,
  Client,
  ExchangeRate,
  Id,
  Payment,
  PaymentMethod,
  Resource,
  Service,
} from '@/lib/model'
import { createSeed, type MockUser } from './seed'

export type StoreState = Readonly<{
  users: readonly MockUser[]
  sessionUserId: Id | null
  clients: readonly Client[]
  services: readonly Service[]
  resources: readonly Resource[]
  paymentMethods: readonly PaymentMethod[]
  rates: readonly ExchangeRate[]
  appointments: readonly Appointment[]
  payments: readonly Payment[]
}>

let state: StoreState = createSeed(todayLocal())

export function getState(): StoreState {
  return state
}

export function commit(next: StoreState): StoreState {
  state = next
  return state
}

export function resetStore(): void {
  state = createSeed(todayLocal())
}

export function nextId(rows: readonly { id: Id }[]): Id {
  return rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1
}

export function findById<T extends { id: Id }>(rows: readonly T[], id: Id): T | undefined {
  return rows.find((row) => row.id === id)
}

export function replaceById<T extends { id: Id }>(rows: readonly T[], updated: T): readonly T[] {
  return rows.map((row) => (row.id === updated.id ? updated : row))
}

export function appendRow<T>(rows: readonly T[], row: T): readonly T[] {
  return [...rows, row]
}
