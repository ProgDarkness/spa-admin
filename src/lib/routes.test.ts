import { describe, expect, it } from 'vitest'
import { PERMISSION_KEYS } from './model'
import { NAV_ITEMS, ROUTES, clientRecordHref } from './routes'

describe('ROUTES', () => {
  it('mantiene las URLs en español del diseño', () => {
    expect(ROUTES).toEqual({
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
    })
  })
})

describe('rutas de acceso', () => {
  it('routes_exposes_setup_and_recover', () => {
    expect(ROUTES.setup).toBe('/setup')
    expect(ROUTES.recover).toBe('/recover')
  })
})

describe('clientRecordHref', () => {
  it('arma la ficha con query id', () => {
    expect(clientRecordHref(7)).toBe('/clientes/ficha?id=7')
  })
})

describe('NAV_ITEMS', () => {
  it('mapea cada entrada a sus permisos', () => {
    const permissionByHref = Object.fromEntries(NAV_ITEMS.map((item) => [item.href, item.permissions]))
    expect(permissionByHref).toEqual({
      [ROUTES.appointments]: ['appointments.read'],
      [ROUTES.clients]: ['clients.read'],
      [ROUTES.catalog]: ['catalog.read'],
      [ROUTES.metrics]: ['metrics.read'],
      [ROUTES.resources]: ['resources.manage'],
      [ROUTES.rates]: ['rates.manage'],
      [ROUTES.paymentMethods]: ['catalog.read', 'payments.read'],
      [ROUTES.backup]: ['backup.manage'],
    })
  })

  it('usa permisos válidos, etiquetas únicas y hrefs únicos', () => {
    for (const item of NAV_ITEMS) {
      expect(item.permissions.length).toBeGreaterThan(0)
      for (const permission of item.permissions) expect(PERMISSION_KEYS).toContain(permission)
      expect(item.label.trim()).not.toBe('')
    }
    expect(new Set(NAV_ITEMS.map((item) => item.label)).size).toBe(NAV_ITEMS.length)
    expect(new Set(NAV_ITEMS.map((item) => item.href)).size).toBe(NAV_ITEMS.length)
  })

  it('solo enlaza rutas conocidas', () => {
    const knownRoutes: readonly string[] = Object.values(ROUTES)
    for (const item of NAV_ITEMS) {
      expect(knownRoutes).toContain(item.href)
    }
  })
})
