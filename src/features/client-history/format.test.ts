import { describe, expect, it } from 'vitest'
import { formatMinutes } from './format'

describe('formatMinutes', () => {
  it.each([
    [0, '0 min'],
    [45, '45 min'],
    [60, '1 h'],
    [105, '1 h 45 min'],
    [120, '2 h'],
  ])('%i minutos se muestra como %s', (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected)
  })
})
