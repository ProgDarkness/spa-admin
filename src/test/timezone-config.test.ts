import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CARACAS = 'America/Caracas'

const read = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('zona horaria fija para el reloj local de los backends simulados', () => {
  it('vitest fija TZ en America/Caracas', () => {
    expect(read('vitest.config.ts')).toContain(`TZ: '${CARACAS}'`)
    expect(process.env.TZ).toBe(CARACAS)
  })

  it('playwright fija TZ del proceso que aloja el backend simulado y la zona del navegador', () => {
    const config = read('playwright.config.ts')

    expect(config).toContain(`process.env.TZ = '${CARACAS}'`)
    expect(config).toContain(`timezoneId: '${CARACAS}'`)
  })
})
