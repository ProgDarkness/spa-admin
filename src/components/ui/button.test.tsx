import { describe, expect, it } from 'vitest'
import { buttonVariants } from './button'

describe('buttonVariants', () => {
  it('destructive no usa text-white', () => {
    const classes = buttonVariants({ variant: 'destructive' })
    expect(classes).not.toMatch(/\btext-white\b/)
    expect(classes).toMatch(/text-primary-foreground|text-destructive-foreground/)
  })
})
