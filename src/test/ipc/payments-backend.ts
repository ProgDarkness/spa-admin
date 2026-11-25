import type {
  AppointmentSummary,
  ExchangeRate,
  PaymentCurrency,
  PaymentInput,
  PaymentMethodSummary,
  PaymentSummary,
} from '@/lib/bindings'
import { dateOf, toLocalDateTime } from '@/lib/datetime'
import type { SessionUser } from '@/lib/model'
import { MAX_AMOUNT_CENTS, MAX_RATE_E4, usdEquivalentCents } from '@/lib/money'
import { countCodePoints, hasDisallowedTextCharacter, trimUnicodeWhitespace } from '@/lib/text'
import type { IpcBackend } from './auth-backend'
import {
  alreadyVoidedError,
  paymentNotFoundError,
  rateMissingError,
  referenceMissingError,
  validationError,
} from './ipc-errors'
import { isRecord, nextRecordId, payloadOf, replaceRecord, requirePermission, type Fields } from './record-backend-support'
import type { SharedRows } from './shared-rows'

export type PaymentsBackendOptions = {
  session: () => SessionUser | null
  payments: readonly PaymentSummary[]
  appointments: SharedRows<AppointmentSummary>
  paymentMethods: SharedRows<PaymentMethodSummary>
  rates: SharedRows<ExchangeRate>
  shared?: SharedRows<PaymentSummary>
  now?: () => number
}

const PAYMENTS_READ = 'payments.read'
const PAYMENTS_WRITE = 'payments.write'
const MAX_VOID_REASON_CHARS = 200
const MIN_RATE_E4 = 1
const CURRENCIES: readonly unknown[] = ['USD', 'VES'] satisfies readonly PaymentCurrency[]

function integerField(fields: Fields, key: string): number {
  const value = fields[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`argumento inválido: ${key}`)
  if (!Number.isSafeInteger(value)) throw validationError(key)
  return value
}

function optionalIntegerField(fields: Fields, key: string): number | null {
  const value = fields[key]
  if (value === null || value === undefined) return null
  return integerField(fields, key)
}

function currencyField(fields: Fields): PaymentCurrency {
  const value = fields.currency
  if (!CURRENCIES.includes(value)) throw new Error('argumento inválido: currency')
  return value as PaymentCurrency
}

function decodedInput(fields: Fields): PaymentInput {
  return {
    appointmentId: integerField(fields, 'appointmentId'),
    methodId: integerField(fields, 'methodId'),
    currency: currencyField(fields),
    amountCents: integerField(fields, 'amountCents'),
    rateBsPerUsdE4: optionalIntegerField(fields, 'rateBsPerUsdE4'),
  }
}

function requireWellFormed(input: PaymentInput): void {
  if (input.appointmentId < 1) throw validationError('appointmentId')
  if (input.methodId < 1) throw validationError('methodId')
  if (input.amountCents < 1 || input.amountCents > MAX_AMOUNT_CENTS) throw validationError('amountCents')
  const rate = input.rateBsPerUsdE4
  if (rate !== null && (rate < MIN_RATE_E4 || rate > MAX_RATE_E4)) throw validationError('rateBsPerUsdE4')
}

function validVoidReason(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('argumento inválido: reason')
  const trimmed = trimUnicodeWhitespace(raw)
  const length = countCodePoints(trimmed)
  if (length < 1 || length > MAX_VOID_REASON_CHARS || hasDisallowedTextCharacter(trimmed)) {
    throw validationError('reason')
  }
  return trimmed
}

function chronologically(first: PaymentSummary, second: PaymentSummary): number {
  return first.paidAt.localeCompare(second.paidAt) || first.id - second.id
}

function appointmentIdArgument(args: unknown): number {
  const value = isRecord(args) ? args.appointmentId : undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('argumento inválido: appointmentId')
  return value
}

export function createPaymentsIpcBackend(next: IpcBackend, options: PaymentsBackendOptions): IpcBackend {
  const now = options.now ?? Date.now
  let rows: readonly PaymentSummary[] = options.payments.map((payment) => ({ ...payment }))
  options.shared?.write(rows)

  function setRows(updated: readonly PaymentSummary[]): void {
    rows = updated
    options.shared?.write(updated)
  }

  function requireActiveMethod(methodId: number): void {
    const method = options.paymentMethods.read().find((row) => row.id === methodId)
    if (!method) throw referenceMissingError('methodId')
    if (!method.active) throw validationError('methodId')
  }

  function rateFor(input: PaymentInput, today: string): number | null {
    if (input.currency === 'USD') return null
    if (input.rateBsPerUsdE4 !== null) return input.rateBsPerUsdE4
    const dayRate = options.rates.read().find((row) => row.date === today)
    if (!dayRate) throw rateMissingError()
    return dayRate.rateBsPerUsdE4
  }

  function equivalentFor(input: PaymentInput, rate: number | null): number {
    if (rate === null) return input.amountCents
    const equivalent = usdEquivalentCents(input.amountCents, rate)
    if (equivalent < 1) throw validationError('amountCents')
    return equivalent
  }

  function listPayments(args: unknown): PaymentSummary[] {
    requirePermission(options.session, PAYMENTS_READ, PAYMENTS_WRITE)
    const appointmentId = appointmentIdArgument(args)
    return rows.filter((row) => row.appointmentId === appointmentId).toSorted(chronologically)
  }

  function createPayment(args: unknown): PaymentSummary {
    requirePermission(options.session, PAYMENTS_WRITE)
    const input = decodedInput(payloadOf(args, 'input'))
    const paidAt = toLocalDateTime(new Date(now()))
    requireWellFormed(input)
    if (!options.appointments.read().some((row) => row.id === input.appointmentId)) {
      throw referenceMissingError('appointmentId')
    }
    requireActiveMethod(input.methodId)
    const rate = rateFor(input, dateOf(paidAt))
    const created: PaymentSummary = {
      id: nextRecordId(rows),
      appointmentId: input.appointmentId,
      methodId: input.methodId,
      currency: input.currency,
      amountCents: input.amountCents,
      rateBsPerUsdE4: rate,
      usdEquivalentCents: equivalentFor(input, rate),
      paidAt,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    }
    setRows([...rows, created])
    return { ...created }
  }

  function voidPayment(args: unknown): PaymentSummary {
    requirePermission(options.session, PAYMENTS_WRITE)
    const actorId = options.session()?.id ?? null
    const fields = payloadOf(args, 'request')
    const id = integerField(fields, 'id')
    const reason = validVoidReason(fields.reason)
    const before = rows.find((row) => row.id === id)
    if (!before) throw paymentNotFoundError()
    if (before.voidedAt !== null) throw alreadyVoidedError(before.id)
    const after: PaymentSummary = {
      ...before,
      voidedAt: toLocalDateTime(new Date(now())),
      voidedBy: actorId,
      voidReason: reason,
    }
    setRows(replaceRecord(rows, after))
    return after
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    list_payments: listPayments,
    create_payment: createPayment,
    void_payment: voidPayment,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
