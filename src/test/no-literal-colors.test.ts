import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LITERAL_COLOR_CLASS =
  /\b(bg|text|border|ring|fill|stroke)-(amber|white|black|gray|slate|zinc|neutral|stone|red|green|blue)(-\d+)?(\/\d+)?\b/g

const LITERAL_COLOR_VALUE = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch)\(/g

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    return entry.name.endsWith('.tsx') && !/\.test\./.test(entry.name) ? [path] : []
  })
}

describe('colores literales de Tailwind', () => {
  it('ningún componente usa clases de color literal', () => {
    const offenders = collectSourceFiles(join(process.cwd(), 'src')).flatMap((file) =>
      (readFileSync(file, 'utf8').match(LITERAL_COLOR_CLASS) ?? []).map((match) => `${file}: ${match}`),
    )
    expect(offenders).toEqual([])
  })

  it('ningún componente usa valores de color literales (hex, rgb, hsl, oklch)', () => {
    const offenders = collectSourceFiles(join(process.cwd(), 'src')).flatMap((file) =>
      (readFileSync(file, 'utf8').match(LITERAL_COLOR_VALUE) ?? []).map((match) => `${file}: ${match}`),
    )
    expect(offenders).toEqual([])
  })
})
