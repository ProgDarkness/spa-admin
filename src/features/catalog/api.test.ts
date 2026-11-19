import { beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import type { ServiceInput } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import { createService, listPaymentMethods, listServices, setServiceActive, updateService } from './api'

const validInput: ServiceInput = { name: 'Depilación', priceCents: 2_500, durationMin: 30 }
const INACTIVE_SEED_ID = 8
const SEED_SERVICE_COUNT = 8
const SEED_ACTIVE_COUNT = 7

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('listServices', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await listServices({ includeInactive: true })).toMatchObject({
      status: 'error',
      error: { code: 'unauthenticated' },
    })
  })

  it('incluye inactivos con includeInactive true', async () => {
    signInAs('lectura')

    const result = await listServices({ includeInactive: true })

    expect(result.status === 'ok' && result.data).toHaveLength(SEED_SERVICE_COUNT)
    expect(result.status === 'ok' && result.data.some((service) => !service.active)).toBe(true)
  })

  it('excluye inactivos con includeInactive false', async () => {
    signInAs('recepcion')

    const result = await listServices({ includeInactive: false })

    expect(result.status === 'ok' && result.data).toHaveLength(SEED_ACTIVE_COUNT)
    expect(result.status === 'ok' && result.data.every((service) => service.active)).toBe(true)
  })

  it('devuelve una copia que no aliasa el estado', async () => {
    signInAs('lectura')

    const result = await listServices({ includeInactive: true })

    expect(result.status === 'ok' && result.data).not.toBe(getState().services)
  })
})

describe('createService', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await createService(validInput)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza con forbidden al usuario de lectura y no cambia el estado', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await createService(validInput)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it('rechaza con forbidden a recepción (sin catalog.write)', async () => {
    signInAs('recepcion')

    expect(await createService(validInput)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('rechaza datos inválidos con validation y el campo, sin tocar el estado', async () => {
    signInAs('propietaria')
    const before = getState()

    const result = await createService({ ...validInput, durationMin: 12 })

    expect(result).toMatchObject({ status: 'error', error: { code: 'validation', field: 'durationMin' } })
    expect(getState()).toBe(before)
  })

  it('autoriza antes de validar: lectura con datos inválidos recibe forbidden', async () => {
    signInAs('lectura')

    expect(await createService({ ...validInput, priceCents: 0 })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
  })

  it('crea un servicio activo en USD con id siguiente y sin mutar el estado previo', async () => {
    signInAs('propietaria')
    const before = getState()
    const previousServices = before.services

    const result = await createService({ ...validInput, name: '  Depilación  ' })

    expect(result).toEqual({
      status: 'ok',
      data: { id: 9, name: 'Depilación', priceCents: 2_500, currency: 'USD', durationMin: 30, active: true },
    })
    expect(previousServices).toHaveLength(SEED_SERVICE_COUNT)
    expect(before.services).toBe(previousServices)
    expect(getState().services).toHaveLength(SEED_SERVICE_COUNT + 1)
    expect(getState().services).not.toBe(previousServices)
    expect(getState().appointments).toBe(before.appointments)
  })
})

describe('updateService', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await updateService(1, validInput)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza con forbidden al usuario de lectura', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await updateService(1, validInput)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it('rechaza datos inválidos con validation y campo', async () => {
    signInAs('propietaria')

    expect(await updateService(1, { ...validInput, name: '' })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'name' },
    })
  })

  it('valida antes de buscar: id inexistente con datos inválidos da validation', async () => {
    signInAs('propietaria')

    expect(await updateService(999, { ...validInput, priceCents: 0 })).toMatchObject({
      status: 'error',
      error: { code: 'validation' },
    })
  })

  it('rechaza un id inexistente con notFound', async () => {
    signInAs('propietaria')
    const before = getState()

    expect(await updateService(999, validInput)).toMatchObject({ status: 'error', error: { code: 'notFound' } })
    expect(getState()).toBe(before)
  })

  it('actualiza solo el servicio objetivo sin mutar referencias previas', async () => {
    signInAs('propietaria')
    const before = getState()
    const previousTarget = before.services[0]
    const previousOther = before.services[1]

    const result = await updateService(1, validInput)

    expect(result).toMatchObject({ status: 'ok', data: { id: 1, ...validInput, active: true } })
    expect(before.services[0]).toBe(previousTarget)
    expect(previousTarget?.name).toBe('Limpieza facial (ejemplo)')
    expect(getState().services[0]).not.toBe(previousTarget)
    expect(getState().services[1]).toBe(previousOther)
  })

  it('conserva el estado activo del servicio', async () => {
    signInAs('propietaria')

    const result = await updateService(INACTIVE_SEED_ID, validInput)

    expect(result).toMatchObject({ status: 'ok', data: { id: INACTIVE_SEED_ID, active: false } })
  })

  it('no altera los snapshots de precio y duración de las citas existentes', async () => {
    signInAs('propietaria')
    const before = getState()
    const affected = before.appointments.filter((appointment) => appointment.serviceId === 1)
    expect(affected.length).toBeGreaterThan(0)

    await updateService(1, { name: 'Limpieza premium', priceCents: 9_900, durationMin: 120 })

    const after = getState().appointments
    expect(after).toBe(before.appointments)
    affected.forEach((appointment) => {
      const current = after.find((candidate) => candidate.id === appointment.id)
      expect(current?.priceCentsSnapshot).toBe(appointment.priceCentsSnapshot)
      expect(current?.durationMinSnapshot).toBe(appointment.durationMinSnapshot)
      expect(current?.endsAt).toBe(appointment.endsAt)
    })
    expect(getState().services[0]?.priceCents).toBe(9_900)
  })
})

describe('setServiceActive', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await setServiceActive(1, false)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza con forbidden al usuario de lectura', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await setServiceActive(1, false)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it('rechaza un id inexistente con notFound', async () => {
    signInAs('propietaria')

    expect(await setServiceActive(999, false)).toMatchObject({ status: 'error', error: { code: 'notFound' } })
  })

  it('desactiva sin borrar: sigue en el listado con includeInactive', async () => {
    signInAs('propietaria')
    const before = getState()

    const result = await setServiceActive(1, false)

    expect(result).toMatchObject({ status: 'ok', data: { id: 1, active: false } })
    expect(before.services[0]?.active).toBe(true)
    expect(getState().services).toHaveLength(SEED_SERVICE_COUNT)
    const all = await listServices({ includeInactive: true })
    const active = await listServices({ includeInactive: false })
    expect(all.status === 'ok' && all.data.find((service) => service.id === 1)?.active).toBe(false)
    expect(active.status === 'ok' && active.data.some((service) => service.id === 1)).toBe(false)
  })

  it('reactiva un servicio inactivo', async () => {
    signInAs('propietaria')

    const result = await setServiceActive(INACTIVE_SEED_ID, true)

    expect(result).toMatchObject({ status: 'ok', data: { id: INACTIVE_SEED_ID, active: true } })
  })

  it('es idempotente y no toca citas', async () => {
    signInAs('propietaria')
    const before = getState()

    const result = await setServiceActive(1, true)

    expect(result).toMatchObject({ status: 'ok', data: { id: 1, active: true } })
    expect(getState().appointments).toBe(before.appointments)
  })
})

describe('listPaymentMethods', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await listPaymentMethods()).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it.each(['propietaria', 'recepcion', 'lectura'] as const)('lista los métodos del seed a %s', async (username) => {
    signInAs(username)

    const result = await listPaymentMethods()

    expect(result.status === 'ok' && result.data.map((method) => method.name)).toEqual([
      'Efectivo',
      'Pago móvil',
      'Zelle',
      'Transferencia',
      'Punto de venta',
    ])
  })

  it('devuelve una copia que no aliasa el estado', async () => {
    signInAs('lectura')

    const result = await listPaymentMethods()

    expect(result.status === 'ok' && result.data).not.toBe(getState().paymentMethods)
  })
})
