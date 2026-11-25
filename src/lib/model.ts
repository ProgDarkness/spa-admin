import type {
  PaymentMethodFilter,
  PaymentMethodSummary,
  ResourceFilter,
  ResourceSummary,
  ServiceFilter,
  ServiceSummary,
} from './bindings'

export type Id = number
export type Cents = number
export type RateE4 = number
export type LocalDate = string
export type LocalDateTime = string
export type YearMonth = string
export type Currency = 'USD' | 'VES'

export const PERMISSION_KEYS = [
  'clients.read',
  'clients.write',
  'catalog.read',
  'catalog.write',
  'resources.manage',
  'appointments.read',
  'appointments.write',
  'appointments.reopen',
  'payments.read',
  'payments.write',
  'rates.manage',
  'metrics.read',
  'audit.read',
  'users.manage',
  'backup.manage',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export type LoginCredentials = { username: string; password: string }
export type SessionUser ={
  id: Id
  username: string
  roleName: string
  permissions: PermissionKey[]
}

export type SessionViewStatus = 'active' | 'locked'
export type SessionView = {
  status: SessionViewStatus
  user: SessionUser | null
}

export type Client = {
  id: Id
  firstName: string
  lastName: string
  nationalId: string
  phone: string
  deletedAt: LocalDateTime | null
}
export type ClientInput = { firstName: string; lastName: string; nationalId: string; phone: string }
export type ClientListFilter = { query: string | null; includeDeleted: boolean }

export type Service = Omit<ServiceSummary, 'currency' | 'createdAt' | 'updatedAt'> & { currency: 'USD' }
export type { ServiceInput } from './bindings'
export type ServiceListFilter = ServiceFilter

export type Resource = Omit<ResourceSummary, 'createdAt' | 'updatedAt'>
export type { ResourceInput, ResourceKind } from './bindings'
export type ResourceListFilter = ResourceFilter

export type PaymentMethod = Omit<PaymentMethodSummary, 'createdAt' | 'updatedAt'>
export type { PaymentMethodInput } from './bindings'
export type PaymentMethodListFilter = PaymentMethodFilter
export type { ExchangeRate } from './bindings'

export type AppointmentStatus = 'scheduled' | 'inProgress' | 'completed' | 'cancelled' | 'noShow'
export type Appointment = {
  id: Id
  clientId: Id
  serviceId: Id
  resourceId: Id
  startsAt: LocalDateTime
  endsAt: LocalDateTime
  status: AppointmentStatus
  priceCentsSnapshot: Cents
  durationMinSnapshot: number
  notes: string | null
}
export type AppointmentInput = {
  clientId: Id
  serviceId: Id
  resourceId: Id
  startsAt: LocalDateTime
  notes: string | null
}
export type AppointmentMove = { startsAt: LocalDateTime; resourceId: Id }
export type AppointmentRange = { from: LocalDate; to: LocalDate; resourceId: Id | null }
export type AppointmentTransition = 'start' | 'complete' | 'markNoShow' | 'cancel' | 'reopen'

export type Payment = {
  id: Id
  appointmentId: Id
  methodId: Id
  currency: Currency
  amountCents: Cents
  rateBsPerUsdE4: RateE4 | null
  usdEquivalentCents: Cents
  paidAt: LocalDateTime
  voidedAt: LocalDateTime | null
  voidedBy: Id | null
  voidReason: string | null
}
export type PaymentInput = {
  appointmentId: Id
  methodId: Id
  currency: Currency
  amountCents: Cents
  rateBsPerUsdE4: RateE4 | null
}

export type AmountsByCurrency = { USD: Cents; VES: Cents }
export type ClientHistoryEntry = Appointment & {
  serviceName: string
  resourceName: string
  payments: Payment[]
}
export type ClientHistory = {
  client: Client
  entries: ClientHistoryEntry[]
  totalMinutes: number
  paidByCurrency: AmountsByCurrency
  collectedOnNonCompletedByCurrency: AmountsByCurrency
}
export type AppointmentCounts = {
  scheduled: number
  inProgress: number
  completed: number
  cancelled: number
  noShow: number
}
export type MonthlyMetrics = {
  month: YearMonth
  newClients: number
  recurringClients: number
  appointments: AppointmentCounts
  revenueByCurrency: AmountsByCurrency
  collectedOnNonCompletedByCurrency: AmountsByCurrency
}

export type AppErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'sessionLocked'
  | 'validation'
  | 'notFound'
  | 'invalidCredentials'
  | 'nationalIdTaken'
  | 'clientDeletedReactivate'
  | 'overlap'
  | 'crossesMidnight'
  | 'resourceInactive'
  | 'resourceHasFutureAppointments'
  | 'invalidTransition'
  | 'rateMissing'
  | 'alreadyVoided'
  | 'internal'

export type AppError = {
  code: AppErrorCode
  message: string
  field: string | null
  entityIds: Id[] | null
}

export type Result<T> = { status: 'ok'; data: T } | { status: 'error'; error: AppError }
