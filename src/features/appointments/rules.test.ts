import { describe, expect, it } from 'vitest'
import type { Appointment, AppointmentStatus, AppointmentTransition } from '@/lib/model'
import { availableTransitions, blocksSlot, canTransition, findOverlaps, SLOT_BLOCKING_STATUSES, statusAfter } from './rules'

const RESOURCE_ID = 1
const OTHER_RESOURCE_ID = 2

function appointmentTemplate(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 10,
    clientId: 1,
    serviceId: 1,
    resourceId: RESOURCE_ID,
    startsAt: '2026-11-13T10:00',
    endsAt: '2026-11-13T11:00',
    status: 'scheduled',
    priceCentsSnapshot: 1000,
    durationMinSnapshot: 60,
    notes: null,
    ...overrides,
  }
}

function candidateAt(startsAt: string, endsAt: string, resourceId = RESOURCE_ID) {
  return { startsAt, endsAt, resourceId }
}

describe('blocksSlot', () => {
  it.each<[AppointmentStatus, boolean]>([
    ['scheduled', true],
    ['inProgress', true],
    ['completed', true],
    ['cancelled', false],
    ['noShow', false],
  ])('estado %s bloquea la franja: %s', (status, expected) => {
    expect(blocksSlot(status)).toBe(expected)
  })

  it('SLOT_BLOCKING_STATUSES lista exactamente scheduled, inProgress y completed', () => {
    expect([...SLOT_BLOCKING_STATUSES].sort()).toEqual(['completed', 'inProgress', 'scheduled'])
  })
})

describe('findOverlaps', () => {
  const existing = [appointmentTemplate()]

  it('un fin igual al inicio de otra cita no solapa', () => {
    expect(findOverlaps(candidateAt('2026-11-13T09:00', '2026-11-13T10:00'), existing, null)).toEqual([])
  })

  it('un inicio igual al fin de otra cita no solapa', () => {
    expect(findOverlaps(candidateAt('2026-11-13T11:00', '2026-11-13T12:00'), existing, null)).toEqual([])
  })

  it('un horario idéntico solapa', () => {
    expect(findOverlaps(candidateAt('2026-11-13T10:00', '2026-11-13T11:00'), existing, null)).toEqual(existing)
  })

  it('un horario contenido solapa', () => {
    expect(findOverlaps(candidateAt('2026-11-13T10:15', '2026-11-13T10:45'), existing, null)).toEqual(existing)
  })

  it('un horario que contiene a la cita solapa', () => {
    expect(findOverlaps(candidateAt('2026-11-13T09:00', '2026-11-13T12:00'), existing, null)).toEqual(existing)
  })

  it('un solape parcial por el inicio solapa', () => {
    expect(findOverlaps(candidateAt('2026-11-13T09:30', '2026-11-13T10:30'), existing, null)).toEqual(existing)
  })

  it('un solape parcial por el final solapa', () => {
    expect(findOverlaps(candidateAt('2026-11-13T10:30', '2026-11-13T11:30'), existing, null)).toEqual(existing)
  })

  it('otro recurso no solapa', () => {
    expect(findOverlaps(candidateAt('2026-11-13T10:00', '2026-11-13T11:00', OTHER_RESOURCE_ID), existing, null)).toEqual([])
  })

  it.each<AppointmentStatus>(['cancelled', 'noShow'])('una cita %s libera la franja', (status) => {
    expect(
      findOverlaps(candidateAt('2026-11-13T10:00', '2026-11-13T11:00'), [appointmentTemplate({ status })], null),
    ).toEqual([])
  })

  it.each<AppointmentStatus>(['scheduled', 'inProgress', 'completed'])('una cita %s bloquea la franja', (status) => {
    expect(
      findOverlaps(candidateAt('2026-11-13T10:00', '2026-11-13T11:00'), [appointmentTemplate({ status })], null),
    ).toHaveLength(1)
  })

  it('ignora la cita indicada por ignoreId', () => {
    expect(findOverlaps(candidateAt('2026-11-13T10:00', '2026-11-13T11:00'), existing, 10)).toEqual([])
  })

  it('con ignoreId sigue devolviendo las demás citas en conflicto', () => {
    const rows = [appointmentTemplate({ id: 10 }), appointmentTemplate({ id: 11 })]

    expect(findOverlaps(candidateAt('2026-11-13T10:00', '2026-11-13T11:00'), rows, 10).map((row) => row.id)).toEqual([11])
  })

  it('devuelve todas las citas en conflicto sin mutar la entrada', () => {
    const rows = [appointmentTemplate({ id: 10 }), appointmentTemplate({ id: 11, startsAt: '2026-11-13T10:30', endsAt: '2026-11-13T11:30' })]
    const snapshot = structuredClone(rows)

    const found = findOverlaps(candidateAt('2026-11-13T10:00', '2026-11-13T12:00'), rows, null)

    expect(found.map((row) => row.id)).toEqual([10, 11])
    expect(rows).toEqual(snapshot)
  })
})

const STARTS_AT = '2026-11-13T10:00'
const BEFORE_START = '2026-11-13T09:59'
const LONG_AFTER = '2026-11-14T08:00'

const ALL_TRANSITIONS: readonly AppointmentTransition[] = ['start', 'complete', 'markNoShow', 'cancel', 'reopen']
const ALL_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'inProgress', 'completed', 'cancelled', 'noShow']

const LEGAL_PAIRS: ReadonlyArray<[AppointmentStatus, AppointmentTransition, AppointmentStatus]> = [
  ['scheduled', 'start', 'inProgress'],
  ['scheduled', 'complete', 'completed'],
  ['inProgress', 'complete', 'completed'],
  ['scheduled', 'markNoShow', 'noShow'],
  ['scheduled', 'cancel', 'cancelled'],
  ['inProgress', 'cancel', 'cancelled'],
  ['completed', 'reopen', 'scheduled'],
  ['cancelled', 'reopen', 'scheduled'],
  ['noShow', 'reopen', 'scheduled'],
]

const isLegal = (status: AppointmentStatus, transition: AppointmentTransition) =>
  LEGAL_PAIRS.some(([from, via]) => from === status && via === transition)

const EVERY_CELL = ALL_STATUSES.flatMap((status) =>
  ALL_TRANSITIONS.map((transition): [AppointmentStatus, AppointmentTransition, boolean] => [
    status,
    transition,
    isLegal(status, transition),
  ]),
)

describe('canTransition', () => {
  it.each(EVERY_CELL)('desde %s con %s (ya iniciada la hora): %s', (status, transition, expected) => {
    expect(canTransition(appointmentTemplate({ status }), transition, LONG_AFTER)).toBe(expected)
  })

  it('completar desde scheduled en la frontera exacta now == startsAt es válido', () => {
    expect(canTransition(appointmentTemplate({ startsAt: STARTS_AT }), 'complete', STARTS_AT)).toBe(true)
  })

  it('completar desde scheduled un minuto antes de startsAt es inválido', () => {
    expect(canTransition(appointmentTemplate({ startsAt: STARTS_AT }), 'complete', BEFORE_START)).toBe(false)
  })

  it('completar desde inProgress no depende de la hora', () => {
    expect(canTransition(appointmentTemplate({ status: 'inProgress', startsAt: STARTS_AT }), 'complete', BEFORE_START)).toBe(true)
  })

  it.each<[AppointmentTransition]>([['start'], ['markNoShow'], ['cancel']])(
    '%s desde scheduled no depende de la hora',
    (transition) => {
      expect(canTransition(appointmentTemplate({ startsAt: STARTS_AT }), transition, BEFORE_START)).toBe(true)
    },
  )
})

describe('statusAfter', () => {
  it.each(LEGAL_PAIRS.map(([, transition, target]): [AppointmentTransition, AppointmentStatus] => [transition, target]))(
    '%s deja la cita en %s',
    (transition, target) => {
      expect(statusAfter(transition)).toBe(target)
    },
  )
})

describe('availableTransitions', () => {
  const names = (status: AppointmentStatus, now: string, canReopen: boolean, startsAt = STARTS_AT) =>
    availableTransitions(appointmentTemplate({ status, startsAt }), now, canReopen)

  it('scheduled ya iniciada ofrece start, complete, markNoShow y cancel en ese orden', () => {
    expect(names('scheduled', STARTS_AT, false)).toEqual(['start', 'complete', 'markNoShow', 'cancel'])
  })

  it('scheduled futura no ofrece complete', () => {
    expect(names('scheduled', BEFORE_START, false)).toEqual(['start', 'markNoShow', 'cancel'])
  })

  it('inProgress ofrece complete y cancel', () => {
    expect(names('inProgress', BEFORE_START, true)).toEqual(['complete', 'cancel'])
  })

  it.each<AppointmentStatus>(['completed', 'cancelled', 'noShow'])('%s solo ofrece reopen si canReopen', (status) => {
    expect(names(status, LONG_AFTER, false)).toEqual([])
    expect(names(status, LONG_AFTER, true)).toEqual(['reopen'])
  })

  it('reopen nunca aparece en una cita no final aunque canReopen sea true', () => {
    expect(names('scheduled', LONG_AFTER, true)).not.toContain('reopen')
  })

  it('no muta la cita', () => {
    const row = appointmentTemplate()
    const snapshot = structuredClone(row)

    availableTransitions(row, LONG_AFTER, true)

    expect(row).toEqual(snapshot)
  })
})
