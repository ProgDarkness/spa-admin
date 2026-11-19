import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandLogo } from './brand-logo'

describe('BrandLogo', () => {
  it('expone role img con nombre accesible Spa', () => {
    render(<BrandLogo />)

    expect(screen.getByRole('img', { name: 'Spa' })).toBeInTheDocument()
  })
})
