import { describe, expect, it } from 'vitest'
import { monthInputSchema } from './schemas'

describe('monthInputSchema', () => {
  it.each(['2026-01', '2026-11', '2026-12'])('acepta %s', (month) => {
    expect(monthInputSchema.safeParse({ month }).success).toBe(true)
  })

  it.each(['2026-13', '2026-00', '26-11', '2026-1', '2026-11-01', '', ' 2026-11'])('rechaza %j', (month) => {
    const parsed = monthInputSchema.safeParse({ month })

    expect(parsed.success).toBe(false)
  })

  it('rechaza valores que no son texto', () => {
    expect(monthInputSchema.safeParse({ month: null }).success).toBe(false)
    expect(monthInputSchema.safeParse({}).success).toBe(false)
  })
})
