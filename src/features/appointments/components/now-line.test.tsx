import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NowLine } from './now-line'

describe('NowLine', () => {
  it('es decorativa: role presentation y marca data-now-line', () => {
    const { container } = render(<NowLine offset={0.5} />)

    const line = container.firstElementChild as HTMLElement
    expect(line).toHaveAttribute('role', 'presentation')
    expect(line).toHaveAttribute('data-now-line')
  })

  it.each([
    [0, '0%'],
    [0.25, '25%'],
    [1, '100%'],
  ])('offset %s posiciona top en %s', (offset, expected) => {
    const { container } = render(<NowLine offset={offset} />)

    expect((container.firstElementChild as HTMLElement).style.top).toBe(expected)
  })

  it('usa clases de linea no interactiva con pulso solo si el usuario admite movimiento', () => {
    const { container } = render(<NowLine offset={0.5} />)

    const line = container.firstElementChild as HTMLElement
    expect(line).toHaveClass('pointer-events-none', 'absolute', 'inset-x-0', 'h-px', 'bg-ring')
    expect(line).toHaveClass('motion-safe:animate-pulse')
    expect(line.className).not.toMatch(/(^|\s)animate-pulse/)
  })
})
