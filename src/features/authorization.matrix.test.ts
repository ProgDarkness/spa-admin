import { beforeEach, describe, expect, it } from 'vitest'
import { getState } from '@/lib/mock/store'
import type { Result } from '@/lib/model'
import type { SeedUsername } from '@/lib/mock/seed'
import { signInAs } from '@/test/session'
import {
  appointmentTemplate,
  errorOf,
  inputTemplate,
  resetWithEmptyAgenda,
  seedAppointments,
  ACTIVE_CLIENT,
  CABIN_ONE,
  DAY,
  FACIAL_SERVICE_ID,
} from '@/test/appointment-fixtures'
import { createAppointment, moveAppointment, transitionAppointment } from './appointments/api'
import { createService, setServiceActive, updateService } from './catalog/api'
import { createClient, reactivateClient, softDeleteClient, updateClient } from './clients/api'
import { createPayment, voidPayment } from './payments/api'
import { upsertRate } from './rates/api'
import { createResource, setResourceActive, updateResource } from './resources/api'

const APPOINTMENT_ID = 100
const CASH_METHOD = 1
const CLIENT_INPUT = { firstName: 'Ana', lastName: 'Pérez', nationalId: 'V-99999999', phone: '04121234567' }
const SERVICE_INPUT = { name: 'Servicio nuevo', priceCents: 1500, durationMin: 30 }
const RESOURCE_INPUT = { name: 'Cabina nueva', kind: 'cabin' } as const

type Mutation = { name: string; run: () => Promise<Result<unknown>> }

const ALL_MUTATIONS: readonly Mutation[] = [
  { name: 'createAppointment', run: () => createAppointment(inputTemplate()) },
  { name: 'moveAppointment', run: () => moveAppointment(APPOINTMENT_ID, { startsAt: `${DAY}T13:00`, resourceId: CABIN_ONE }) },
  { name: 'transitionAppointment', run: () => transitionAppointment(APPOINTMENT_ID, 'start') },
  { name: 'createService', run: () => createService(SERVICE_INPUT) },
  { name: 'updateService', run: () => updateService(FACIAL_SERVICE_ID, SERVICE_INPUT) },
  { name: 'setServiceActive', run: () => setServiceActive(FACIAL_SERVICE_ID, false) },
  { name: 'createClient', run: () => createClient(CLIENT_INPUT) },
  { name: 'updateClient', run: () => updateClient(ACTIVE_CLIENT, CLIENT_INPUT) },
  { name: 'softDeleteClient', run: () => softDeleteClient(ACTIVE_CLIENT) },
  { name: 'reactivateClient', run: () => reactivateClient(ACTIVE_CLIENT) },
  { name: 'createResource', run: () => createResource(RESOURCE_INPUT) },
  { name: 'updateResource', run: () => updateResource(CABIN_ONE, RESOURCE_INPUT) },
  { name: 'setResourceActive', run: () => setResourceActive(CABIN_ONE, false) },
  { name: 'upsertRate', run: () => upsertRate(DAY, 370000) },
  {
    name: 'createPayment',
    run: () =>
      createPayment({
        appointmentId: APPOINTMENT_ID,
        methodId: CASH_METHOD,
        currency: 'USD',
        amountCents: 2000,
        rateBsPerUsdE4: null,
      }),
  },
  { name: 'voidPayment', run: () => voidPayment(1, 'motivo de prueba') },
]

const RECEPTION_FORBIDDEN: readonly Mutation[] = [
  ALL_MUTATIONS.find((mutation) => mutation.name === 'createService'),
  ALL_MUTATIONS.find((mutation) => mutation.name === 'updateService'),
  ALL_MUTATIONS.find((mutation) => mutation.name === 'setServiceActive'),
  ALL_MUTATIONS.find((mutation) => mutation.name === 'createResource'),
  ALL_MUTATIONS.find((mutation) => mutation.name === 'updateResource'),
  ALL_MUTATIONS.find((mutation) => mutation.name === 'setResourceActive'),
  { name: 'transitionAppointment reopen', run: () => transitionAppointment(APPOINTMENT_ID, 'reopen') },
].filter((mutation): mutation is Mutation => mutation !== undefined)

function prepare(username: SeedUsername): void {
  resetWithEmptyAgenda()
  seedAppointments(appointmentTemplate({ id: APPOINTMENT_ID, status: 'completed' }))
  signInAs(username)
}

async function expectForbiddenWithoutMutation(mutation: Mutation): Promise<void> {
  const before = structuredClone(getState())
  const result = await mutation.run()
  expect(errorOf(result).code).toBe('forbidden')
  expect(getState()).toEqual(before)
}

describe('matriz de autorización: rol lectura', () => {
  beforeEach(() => prepare('lectura'))

  it.each(ALL_MUTATIONS.map((mutation) => [mutation.name, mutation] as const))(
    '%s devuelve forbidden y no muta el store',
    async (_name, mutation) => {
      await expectForbiddenWithoutMutation(mutation)
    },
  )
})

describe('matriz de autorización: rol recepcion', () => {
  beforeEach(() => prepare('recepcion'))

  it.each(RECEPTION_FORBIDDEN.map((mutation) => [mutation.name, mutation] as const))(
    '%s devuelve forbidden y no muta el store',
    async (_name, mutation) => {
      await expectForbiddenWithoutMutation(mutation)
    },
  )
})
