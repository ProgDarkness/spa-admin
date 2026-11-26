import type { Id, PermissionKey } from './model'

export const ROUTES = {
  home: '/',
  login: '/login',
  setup: '/setup',
  recover: '/recover',
  appointments: '/citas',
  clients: '/clientes',
  clientRecord: '/clientes/ficha',
  catalog: '/catalogo',
  metrics: '/metricas',
  resources: '/ajustes/recursos',
  rates: '/ajustes/tasas',
  paymentMethods: '/ajustes/metodos-pago',
  backup: '/ajustes/respaldo',
  restoreFirstRun: '/setup/restaurar',
} as const

export const RESTORED_LOGIN_HREF = `${ROUTES.login}?restored=1`

export function clientRecordHref(clientId: Id): string {
  return `${ROUTES.clientRecord}?id=${clientId}`
}

export type NavItem = { label: string; href: string; permissions: readonly PermissionKey[] }

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Citas', href: ROUTES.appointments, permissions: ['appointments.read'] },
  { label: 'Clientes', href: ROUTES.clients, permissions: ['clients.read'] },
  { label: 'Catálogo', href: ROUTES.catalog, permissions: ['catalog.read'] },
  { label: 'Métricas', href: ROUTES.metrics, permissions: ['metrics.read'] },
  { label: 'Recursos', href: ROUTES.resources, permissions: ['resources.manage'] },
  { label: 'Tasas', href: ROUTES.rates, permissions: ['rates.manage'] },
  { label: 'Métodos de pago', href: ROUTES.paymentMethods, permissions: ['catalog.read', 'payments.read'] },
  { label: 'Respaldo', href: ROUTES.backup, permissions: ['backup.manage'] },
]
