import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

function rootHex(variable: string): string | undefined {
  return new RegExp(`--${variable}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(rootBlock)?.[1]?.toUpperCase()
}

function channel(value: number): number {
  const ratio = value / 255
  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => channel(parseInt(hex.slice(start, start + 2), 16)))
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter! + 0.05) / (darker! + 0.05)
}

const TINTA = '#1B211D'
const PIEDRA = '#EEF0EA'
const MARFIL = '#FAFAF7'
const MUSGO = '#1F2A24'
const BRONCE_TEXTO = '#7F5C25'
const ERROR = '#A8483C'
const BRONCE = '#A67C3B'
const SALVIA = '#8A9A86'
const SALVIA_OSCURO = '#6F8069'

describe('paleta del tema', () => {
  it.each([
    ['background', PIEDRA],
    ['card', MARFIL],
    ['primary', MUSGO],
    ['foreground', TINTA],
    ['ring', BRONCE],
    ['border', SALVIA],
    ['destructive', ERROR],
    ['input', SALVIA_OSCURO],
  ])('--%s usa el hex de la paleta %s', (variable, expected) => {
    expect(rootHex(variable)).toBe(expected)
  })

  it.each([
    ['tinta sobre piedra', TINTA, PIEDRA],
    ['tinta sobre marfil', TINTA, MARFIL],
    ['marfil sobre musgo', MARFIL, MUSGO],
    ['bronce oscuro sobre marfil', BRONCE_TEXTO, MARFIL],
    ['bronce oscuro sobre piedra', BRONCE_TEXTO, PIEDRA],
    ['error sobre marfil', ERROR, MARFIL],
  ])('%s cumple AA de texto (>= 4.5)', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['foco bronce sobre piedra', BRONCE, PIEDRA],
    ['borde de control (--input) salvia oscuro sobre marfil', SALVIA_OSCURO, MARFIL],
  ])('%s cumple contraste no textual (>= 3)', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })

  it('no define modo oscuro', () => {
    expect(css).not.toMatch(/\.dark\b/)
    expect(css).not.toMatch(/prefers-color-scheme\s*:\s*dark/)
  })
})
