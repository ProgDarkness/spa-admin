import { describe, expect, it } from 'vitest'
import { freezeDate } from '@/test/clock'
import {
  LOCAL_DATE_PATTERN,
  LOCAL_DATE_TIME_PATTERN,
  addDays,
  addMinutes,
  crossesMidnight,
  dateOf,
  isExistingDate,
  monthOf,
  nowLocal,
  overlaps,
  startOfWeek,
  toLocalDateTime,
  todayLocal,
} from './datetime'

describe('patrones', () => {
  it('validan los formatos fijos', () => {
    expect(LOCAL_DATE_PATTERN.test('2026-11-12')).toBe(true)
    expect(LOCAL_DATE_PATTERN.test('2026-11-12T09:00')).toBe(false)
    expect(LOCAL_DATE_TIME_PATTERN.test('2026-11-12T09:00')).toBe(true)
    expect(LOCAL_DATE_TIME_PATTERN.test('2026-11-12T09:00:00')).toBe(false)
    expect(LOCAL_DATE_TIME_PATTERN.test('2026-11-12 09:00')).toBe(false)
  })
})

describe('reloj local', () => {
  it('nowLocal y todayLocal leen la fecha congelada', () => {
    freezeDate('2026-11-12T09:05')
    expect(nowLocal()).toBe('2026-11-12T09:05')
    expect(todayLocal()).toBe('2026-11-12')
  })

  it('toLocalDateTime rellena con ceros usando getters locales', () => {
    expect(toLocalDateTime(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03')
    expect(toLocalDateTime(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31T23:59')
  })
})

describe('addMinutes', () => {
  it('suma dentro del mismo día', () => {
    expect(addMinutes('2026-11-12T09:00', 45)).toBe('2026-11-12T09:45')
  })

  it('cruza al día siguiente', () => {
    expect(addMinutes('2026-11-12T23:30', 60)).toBe('2026-11-13T00:30')
  })

  it('cruza fin de mes y de año', () => {
    expect(addMinutes('2026-12-31T23:30', 60)).toBe('2027-01-01T00:30')
  })

  it('acepta minutos negativos y cero', () => {
    expect(addMinutes('2026-11-01T00:10', -20)).toBe('2026-10-31T23:50')
    expect(addMinutes('2026-11-12T09:00', 0)).toBe('2026-11-12T09:00')
  })
})

describe('addDays', () => {
  it('suma y resta días respetando meses y bisiestos', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-11-12', 0)).toBe('2026-11-12')
    expect(addDays('2026-11-12', 30)).toBe('2026-12-12')
  })
})

describe('dateOf / monthOf', () => {
  it('extraen fecha y mes', () => {
    expect(dateOf('2026-11-12T09:00')).toBe('2026-11-12')
    expect(monthOf('2026-11-12T09:00')).toBe('2026-11')
    expect(monthOf('2026-11-12')).toBe('2026-11')
  })

  it('el límite de mes asigna 23:30 a octubre y 00:00 a noviembre', () => {
    expect(monthOf('2026-10-31T23:30')).toBe('2026-10')
    expect(monthOf('2026-11-01T00:00')).toBe('2026-11')
  })
})

describe('startOfWeek', () => {
  it('devuelve el lunes de la semana', () => {
    expect(startOfWeek('2026-11-12')).toBe('2026-11-09')
    expect(startOfWeek('2026-11-09')).toBe('2026-11-09')
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09')
    expect(startOfWeek('2026-11-16')).toBe('2026-11-16')
  })

  it('cruza el mes y el año hacia atrás', () => {
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26')
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28')
  })
})

describe('overlaps', () => {
  const base = { startsAt: '2026-11-12T10:00', endsAt: '2026-11-12T11:00' }

  it('fin == inicio no solapa en ambos sentidos', () => {
    const next = { startsAt: '2026-11-12T11:00', endsAt: '2026-11-12T12:00' }
    expect(overlaps(base, next)).toBe(false)
    expect(overlaps(next, base)).toBe(false)
  })

  it('idéntico, contenido y parcial solapan', () => {
    expect(overlaps(base, base)).toBe(true)
    expect(overlaps(base, { startsAt: '2026-11-12T10:15', endsAt: '2026-11-12T10:45' })).toBe(true)
    expect(overlaps({ startsAt: '2026-11-12T10:15', endsAt: '2026-11-12T10:45' }, base)).toBe(true)
    expect(overlaps(base, { startsAt: '2026-11-12T10:30', endsAt: '2026-11-12T11:30' })).toBe(true)
    expect(overlaps(base, { startsAt: '2026-11-12T09:30', endsAt: '2026-11-12T10:05' })).toBe(true)
  })

  it('separados no solapan', () => {
    expect(overlaps(base, { startsAt: '2026-11-12T12:00', endsAt: '2026-11-12T13:00' })).toBe(false)
  })

  it('días distintos no solapan', () => {
    expect(overlaps(base, { startsAt: '2026-11-13T10:00', endsAt: '2026-11-13T11:00' })).toBe(false)
  })
})

describe('isExistingDate', () => {
  it.each(['2026-11-12', '2026-02-28', '2028-02-29', '2026-12-31'])('acepta %s', (date) => {
    expect(isExistingDate(date)).toBe(true)
  })

  it.each([
    '2026-02-31',
    '2026-02-29',
    '2026-13-45',
    '2026-00-10',
    '2026-11-00',
    '2026-04-31',
    'hoy',
    '',
    '2026-11-1',
    '2026-11-12T09:00',
  ])('rechaza %j', (date) => {
    expect(isExistingDate(date)).toBe(false)
  })
})

describe('crossesMidnight', () => {
  it('termina exactamente a las 00:00 del día siguiente: se permite', () => {
    expect(crossesMidnight('2026-11-12T23:00', 60)).toBe(false)
    expect(crossesMidnight('2026-11-12T23:55', 5)).toBe(false)
    expect(crossesMidnight('2026-11-12T00:00', 1_440)).toBe(false)
  })

  it('pasa de las 00:00 del día siguiente: cruza', () => {
    expect(crossesMidnight('2026-11-12T23:30', 60)).toBe(true)
    expect(crossesMidnight('2026-11-12T23:55', 10)).toBe(true)
    expect(crossesMidnight('2026-12-31T23:30', 60)).toBe(true)
  })

  it('dentro del mismo día no cruza', () => {
    expect(crossesMidnight('2026-11-12T22:30', 60)).toBe(false)
    expect(crossesMidnight('2026-11-12T08:00', 60)).toBe(false)
  })
})
