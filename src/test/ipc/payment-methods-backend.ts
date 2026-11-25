import type {
  PaymentMethodActivation,
  PaymentMethodFilter,
  PaymentMethodInput,
  PaymentMethodSummary,
  PaymentMethodUpdate,
} from '@/lib/bindings'
import type { PaymentMethod, SessionUser } from '@/lib/model'
import type { IpcBackend } from './auth-backend'
import { validationError } from './ipc-errors'
import {
  booleanField,
  nextRecordId,
  normalizedRecordName,
  payloadOf,
  recordNameKey,
  replaceRecord,
  requirePermission,
  toInstant,
  type Fields,
} from './record-backend-support'

export type PaymentMethodsBackendOptions = {
  session: () => SessionUser | null
  paymentMethods: readonly PaymentMethod[]
  now?: () => number
}

const CATALOG_READ = 'catalog.read'
const PAYMENTS_READ = 'payments.read'
const CATALOG_WRITE = 'catalog.write'
const ASCII_UPPERCASE = /[A-Z]/g

function asciiFolded(name: string): string {
  return name.replace(ASCII_UPPERCASE, (letter) => letter.toLowerCase())
}

const utf8 = new TextEncoder()

function compareUtf8Bytes(first: string, second: string): number {
  const firstBytes = utf8.encode(first)
  const secondBytes = utf8.encode(second)
  const shared = Math.min(firstBytes.length, secondBytes.length)
  for (let index = 0; index < shared; index += 1) {
    const difference = (firstBytes[index] ?? 0) - (secondBytes[index] ?? 0)
    if (difference !== 0) return difference
  }
  return firstBytes.length - secondBytes.length
}

function byNameThenId(first: PaymentMethodSummary, second: PaymentMethodSummary): number {
  const byName = compareUtf8Bytes(asciiFolded(first.name), asciiFolded(second.name))
  return byName !== 0 ? byName : first.id - second.id
}

function asSummary(method: PaymentMethod, instant: string): PaymentMethodSummary {
  return { ...method, createdAt: instant, updatedAt: instant }
}

export function createPaymentMethodsIpcBackend(next: IpcBackend, options: PaymentMethodsBackendOptions): IpcBackend {
  const now = options.now ?? Date.now
  let rows: readonly PaymentMethodSummary[] = options.paymentMethods.map((method) => asSummary(method, toInstant(now())))

  function validName(raw: unknown): string {
    const name = normalizedRecordName(raw)
    if (name === null) throw validationError('name')
    return name
  }

  function requireMethod(id: unknown): PaymentMethodSummary {
    const found = rows.find((row) => row.id === id)
    if (!found) throw validationError('id')
    return found
  }

  function ensureNameFree(name: string, exceptId: number | null): void {
    const key = recordNameKey(name)
    if (rows.some((row) => row.id !== exceptId && recordNameKey(row.name) === key)) throw validationError('name')
  }

  function listPaymentMethods(args: unknown): PaymentMethodSummary[] {
    requirePermission(options.session, CATALOG_READ, PAYMENTS_READ)
    const filter = payloadOf(args, 'filter') as PaymentMethodFilter
    return rows.filter((row) => filter.includeInactive || row.active).toSorted(byNameThenId)
  }

  function createPaymentMethod(args: unknown): PaymentMethodSummary {
    requirePermission(options.session, CATALOG_WRITE)
    const input = payloadOf(args, 'input') as Partial<PaymentMethodInput> & Fields
    const name = validName(input.name)
    ensureNameFree(name, null)
    const instant = toInstant(now())
    const created: PaymentMethodSummary = {
      id: nextRecordId(rows),
      name,
      active: true,
      createdAt: instant,
      updatedAt: instant,
    }
    rows = [...rows, created]
    return created
  }

  function updatePaymentMethod(args: unknown): PaymentMethodSummary {
    requirePermission(options.session, CATALOG_WRITE)
    const fields = payloadOf(args, 'update') as Partial<PaymentMethodUpdate> & Fields
    const before = requireMethod(fields.id)
    const name = validName(fields.name)
    ensureNameFree(name, before.id)
    if (before.name === name) return before
    const after: PaymentMethodSummary = { ...before, name, updatedAt: toInstant(now()) }
    rows = replaceRecord(rows, after)
    return after
  }

  function setPaymentMethodActive(args: unknown): PaymentMethodSummary {
    requirePermission(options.session, CATALOG_WRITE)
    const fields = payloadOf(args, 'activation') as Partial<PaymentMethodActivation> & Fields
    const active = booleanField(fields, 'active')
    const before = requireMethod(fields.id)
    if (before.active === active) return before
    const after: PaymentMethodSummary = { ...before, active, updatedAt: toInstant(now()) }
    rows = replaceRecord(rows, after)
    return after
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    list_payment_methods: listPaymentMethods,
    create_payment_method: createPaymentMethod,
    update_payment_method: updatePaymentMethod,
    set_payment_method_active: setPaymentMethodActive,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
