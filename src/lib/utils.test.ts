import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('combina clases en una sola cadena', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center')
  })

  it('resuelve conflictos de Tailwind dejando la última clase', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('ignora valores falsy', () => {
    expect(cn('flex', false, null, undefined, '', 0, 'gap-2')).toBe('flex gap-2')
  })

  it('acepta objetos y arreglos condicionales', () => {
    expect(cn(['a', { b: true, c: false }])).toBe('a b')
  })

  it('devuelve cadena vacía sin entradas', () => {
    expect(cn()).toBe('')
  })
})
