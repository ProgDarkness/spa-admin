import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState } from '@/lib/mock/store'
import type { Resource, Service } from '@/lib/model'
import {
  appointmentTemplate,
  CABIN_ONE,
  dataOf,
  errorOf,
  FACIAL_SERVICE_ID,
  inputTemplate,
  resetWithEmptyAgenda,
} from '@/test/appointment-fixtures'
import { stubRustCatalog } from '@/test/rust-backend-stub'
import { signInAs } from '@/test/session'
import { createAppointment } from './api'

const RUST_PRICE_CENTS = 9_900
const RUST_DURATION_MIN = 30
const RUST_ONLY_ID = 500

function rustService(overrides: Partial<Service> = {}): Service {
  return {
    id: FACIAL_SERVICE_ID,
    name: 'Servicio de Rust',
    priceCents: RUST_PRICE_CENTS,
    currency: 'USD',
    durationMin: RUST_DURATION_MIN,
    active: true,
    ...overrides,
  }
}

function rustResource(overrides: Partial<Resource> = {}): Resource {
  return { id: CABIN_ONE, name: 'Sala de Rust', kind: 'cabin', active: true, ...overrides }
}

beforeEach(() => {
  resetWithEmptyAgenda()
  signInAs('recepcion')
})

describe('createAppointment refresca el espejo desde Rust antes de validar', () => {
  it('funciona con el store sin servicios ni recursos usando los de Rust', async () => {
    commit({ ...getState(), services: [], resources: [] })
    stubRustCatalog({
      services: [rustService({ id: RUST_ONLY_ID })],
      resources: [rustResource({ id: RUST_ONLY_ID })],
    })

    const created = dataOf(
      await createAppointment(inputTemplate({ serviceId: RUST_ONLY_ID, resourceId: RUST_ONLY_ID })),
    )

    expect(created.priceCentsSnapshot).toBe(RUST_PRICE_CENTS)
    expect(created.durationMinSnapshot).toBe(RUST_DURATION_MIN)
  })

  it('usa el precio y la duración de Rust cuando el id coincide con el del seed', async () => {
    stubRustCatalog({ services: [rustService()], resources: [rustResource()] })

    const created = dataOf(await createAppointment(inputTemplate()))

    expect(created.priceCentsSnapshot).toBe(RUST_PRICE_CENTS)
    expect(created.durationMinSnapshot).toBe(RUST_DURATION_MIN)
    expect(created.endsAt).toBe(inputTemplate().startsAt.replace('12:00', '12:30'))
  })

  it('rechaza un servicio del seed que Rust no devuelve', async () => {
    stubRustCatalog({ services: [], resources: [rustResource()] })

    expect(errorOf(await createAppointment(inputTemplate())).code).toBe('notFound')
  })

  it('rechaza con inactivo un servicio que Rust marca inactivo aunque el seed lo tenga activo', async () => {
    stubRustCatalog({ services: [rustService({ active: false })], resources: [rustResource()] })

    expect(errorOf(await createAppointment(inputTemplate())).code).toBe('validation')
  })

  it('consulta a Rust servicios y recursos con includeInactive true', async () => {
    const calls = stubRustCatalog({ services: [rustService()], resources: [rustResource()] })

    await createAppointment(inputTemplate())

    expect(calls.toSorted()).toEqual(['list_resources', 'list_services'])
  })

  it('no consulta a Rust si la entrada no pasa el esquema', async () => {
    const calls = stubRustCatalog({})

    await createAppointment(inputTemplate({ startsAt: 'no-es-fecha' }))

    expect(calls).toEqual([])
  })

  it.each(['list_services', 'list_resources'])('devuelve el error y no crea la cita si falla %s', async (failing) => {
    stubRustCatalog({ services: [rustService()], resources: [rustResource()], failing: [failing] })
    const before = getState().appointments

    expect(errorOf(await createAppointment(inputTemplate())).code).toBe('internal')
    expect(getState().appointments).toBe(before)
  })

  it('el id de cita sigue siendo secuencial sobre las citas del store', async () => {
    commit({ ...getState(), appointments: [appointmentTemplate({ id: 41, startsAt: '2026-11-13T08:00', endsAt: '2026-11-13T08:30' })] })
    stubRustCatalog({ services: [rustService()], resources: [rustResource()] })

    expect(dataOf(await createAppointment(inputTemplate())).id).toBe(42)
  })
})
