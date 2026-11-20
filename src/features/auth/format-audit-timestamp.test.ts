import { describe, expect, it } from 'vitest'
import { formatAuditTimestamp } from './format-audit-timestamp'

describe('formatAuditTimestamp', () => {
  it.each([
    ['2026-11-12T10:05:33', '12/11/2026 10:05'],
    ['2026-11-12 10:05:33', '12/11/2026 10:05'],
    ['2026-01-02T03:04', '02/01/2026 03:04'],
    ['2026-11-12T10:05:33.123Z', '12/11/2026 10:05'],
  ])('formatea %s como %s', (raw, expected) => {
    expect(formatAuditTimestamp(raw)).toBe(expected)
  })

  it.each(['', 'ayer', '2026-13-45T99:99:99', '12/11/2026 10:05'])('devuelve el texto original si no lo entiende (%j)', (raw) => {
    expect(formatAuditTimestamp(raw)).toBe(raw)
  })
})
