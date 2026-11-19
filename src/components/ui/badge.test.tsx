import { describe, expect, it } from 'vitest'
import { badgeVariants } from './badge'

describe('badgeVariants', () => {
  it('destructive no usa text-white', () => {
    const classes = badgeVariants({ variant: 'destructive' })
    expect(classes).not.toMatch(/\btext-white\b/)
    expect(classes).toMatch(/text-primary-foreground|text-destructive-foreground/)
  })
})
