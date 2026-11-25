import { commands, type PaymentMethodSummary } from '@/lib/bindings'
import { callBackend } from '@/lib/ipc'
import { createMirrorSync, visibleRows } from '@/lib/mirror-sync'
import { commit, getState, upsertById } from '@/lib/mock/store'
import type { Id, PaymentMethod, PaymentMethodInput, PaymentMethodListFilter, Result } from '@/lib/model'
import { mapOk } from '@/lib/result'

const FULL_COLLECTION: PaymentMethodListFilter = { includeInactive: true }

const mirrorSync = createMirrorSync()

function toPaymentMethod(summary: PaymentMethodSummary): PaymentMethod {
  return { id: summary.id, name: summary.name, active: summary.active }
}

function replacePaymentMethods(paymentMethods: readonly PaymentMethod[]): void {
  commit({ ...getState(), paymentMethods })
}

function mirrorPaymentMethod(paymentMethod: PaymentMethod): void {
  const state = getState()
  commit({ ...state, paymentMethods: upsertById(state.paymentMethods, paymentMethod) })
}

function callPaymentMethodBackend(
  operation: () => Promise<Result<PaymentMethodSummary>>,
): Promise<Result<PaymentMethod>> {
  return callBackend(async () => mapOk(await operation(), toPaymentMethod), mirrorSync.reflectMutation(mirrorPaymentMethod))
}

export async function listPaymentMethods(filter: PaymentMethodListFilter): Promise<Result<PaymentMethod[]>> {
  const full = await mirrorSync.list(
    async () => mapOk(await commands.listPaymentMethods(FULL_COLLECTION), (rows) => rows.map(toPaymentMethod)),
    replacePaymentMethods,
  )
  return mapOk(full, (methods) => visibleRows(methods, filter))
}

export function createPaymentMethod(input: PaymentMethodInput): Promise<Result<PaymentMethod>> {
  return callPaymentMethodBackend(() => commands.createPaymentMethod(input))
}

export function updatePaymentMethod(id: Id, input: PaymentMethodInput): Promise<Result<PaymentMethod>> {
  return callPaymentMethodBackend(() => commands.updatePaymentMethod({ id, ...input }))
}

export function setPaymentMethodActive(id: Id, active: boolean): Promise<Result<PaymentMethod>> {
  return callPaymentMethodBackend(() => commands.setPaymentMethodActive({ id, active }))
}
