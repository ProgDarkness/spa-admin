import { describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/model'
import { APPOINTMENT_STATUS_LABELS, buildAppointmentLabels, fieldErrorOf, timeOf } from './labels'

describe('buildAppointmentLabels', () => {
  const labels = buildAppointmentLabels(
    [{ id: 1, firstName: 'María', lastName: 'González', nationalId: 'V-1', phone: '1', deletedAt: null }],
    [{ id: 2, name: 'Limpieza', priceCents: 1, currency: 'USD', durationMin: 60, active: true }],
    [{ id: 3, name: 'Cabina 1', kind: 'cabin', active: true }],
  )

  it('resuelve nombres por id', () => {
    expect(labels.clientNameOf(1)).toBe('María González')
    expect(labels.serviceNameOf(2)).toBe('Limpieza')
    expect(labels.resourceNameOf(3)).toBe('Cabina 1')
  })

  it('devuelve un texto neutro cuando el id no existe o aún no cargó', () => {
    expect(labels.clientNameOf(99)).toBe('Cliente')
    expect(labels.serviceNameOf(99)).toBe('Servicio')
    expect(labels.resourceNameOf(99)).toBe('Recurso')
  })
})

describe('timeOf', () => {
  it('extrae HH:mm', () => {
    expect(timeOf('2026-11-12T09:05')).toBe('09:05')
  })
})

describe('APPOINTMENT_STATUS_LABELS', () => {
  it('cubre todos los estados en español', () => {
    expect(APPOINTMENT_STATUS_LABELS).toEqual({
      scheduled: 'Programada',
      inProgress: 'En curso',
      completed: 'Completada',
      cancelled: 'Cancelada',
      noShow: 'No asistió',
    })
  })
})

describe('fieldErrorOf', () => {
  const failure = (field: string | null): AppError => ({ code: 'validation', message: 'm', field, entityIds: null })

  it('devuelve el campo cuando pertenece al formulario', () => {
    expect(fieldErrorOf(failure('serviceId'), ['clientId', 'serviceId'])).toBe('serviceId')
  })

  it('devuelve null cuando el campo es ajeno o no hay campo o no hay error', () => {
    expect(fieldErrorOf(failure('otro'), ['clientId'])).toBeNull()
    expect(fieldErrorOf(failure(null), ['clientId'])).toBeNull()
    expect(fieldErrorOf(null, ['clientId'])).toBeNull()
  })
})
