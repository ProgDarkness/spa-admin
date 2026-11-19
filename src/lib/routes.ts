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
} as const

export function clientRecordHref(clientId: Id): string {
  return `${ROUTES.clientRecord}?id=${clientId}`
}

export type NavItem = { label: string; href: string; permission: PermissionKey }

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Citas', href: ROUTES.appointments, permission: 'appointments.read' },
  { label: 'Clientes', href: ROUTES.clients, permission: 'clients.read' },
  { label: 'Catálogo', href: ROUTES.catalog, permission: 'catalog.read' },
  { label: 'Métricas', href: ROUTES.metrics, permission: 'metrics.read' },
  { label: 'Recursos', href: ROUTES.resources, permission: 'resources.manage' },
  { label: 'Tasas', href: ROUTES.rates, permission: 'rates.manage' },
]
