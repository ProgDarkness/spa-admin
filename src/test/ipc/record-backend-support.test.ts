import { describe, expect, it } from 'vitest'
import type { SessionUser } from '@/lib/model'
import { forbiddenError, unauthenticatedError } from './ipc-errors'
import {
  booleanField,
  isRecord,
  nextRecordId,
  normalizedRecordName,
  payloadOf,
  recordNameKey,
  replaceRecord,
  requirePermission,
  toInstant,
} from './record-backend-support'

const MAX_NAME_CHARS = 80

function userWith(...permissions: string[]): SessionUser {
  return { id: 1, username: 'tester', roleName: 'Prueba', permissions: permissions as SessionUser['permissions'] }
}

describe('isRecord', () => {
  it.each([[{}], [{ a: 1 }], [[]]])('acepta el objeto %j', (value) => {
    expect(isRecord(value)).toBe(true)
  })

  it.each([[null], [undefined], ['texto'], [7], [true]])('rechaza %j', (value) => {
    expect(isRecord(value)).toBe(false)
  })
})

describe('payloadOf', () => {
  it('devuelve el objeto bajo la clave pedida', () => {
    const payload = { name: 'x' }

    expect(payloadOf({ input: payload }, 'input')).toBe(payload)
  })

  it.each([[null], [undefined], ['texto'], [{}], [{ other: {} }], [{ input: null }], [{ input: 'texto' }]])(
    'lanza si la clave input no es un objeto en %j',
    (args) => {
      expect(() => payloadOf(args, 'input')).toThrow('argumento inválido: input')
    },
  )

  it('nombra la clave que falta en el mensaje', () => {
    expect(() => payloadOf({}, 'update')).toThrow('argumento inválido: update')
  })
})

describe('booleanField', () => {
  it.each([true, false])('devuelve %s', (value) => {
    expect(booleanField({ active: value }, 'active')).toBe(value)
  })

  it.each([['true'], [1], [0], [null], [undefined]])('lanza con %j', (value) => {
    expect(() => booleanField({ active: value }, 'active')).toThrow('argumento inválido: active')
  })

  it('lanza si la clave no existe y la nombra', () => {
    expect(() => booleanField({}, 'enabled')).toThrow('argumento inválido: enabled')
  })
})

describe('normalizedRecordName', () => {
  it('recorta los bordes, colapsa espacios repetidos y compone en NFC', () => {
    expect(normalizedRecordName('  Cabina   é  ')).toBe('Cabina é')
  })

  it.each([[null], [undefined], [7], [{}], [['a']]])('devuelve null si no es texto (%j)', (value) => {
    expect(normalizedRecordName(value)).toBeNull()
  })

  it.each([[''], ['   '], ['　']])('devuelve null para el nombre vacío %j', (value) => {
    expect(normalizedRecordName(value)).toBeNull()
  })

  it('acepta exactamente el máximo de caracteres', () => {
    expect(normalizedRecordName('a'.repeat(MAX_NAME_CHARS))).toBe('a'.repeat(MAX_NAME_CHARS))
  })

  it('rechaza un carácter por encima del máximo', () => {
    expect(normalizedRecordName('a'.repeat(MAX_NAME_CHARS + 1))).toBeNull()
  })

  it('cuenta puntos de código y no unidades UTF-16', () => {
    expect(normalizedRecordName('😀'.repeat(MAX_NAME_CHARS))).toBe('😀'.repeat(MAX_NAME_CHARS))
    expect(normalizedRecordName('😀'.repeat(MAX_NAME_CHARS + 1))).toBeNull()
  })

  it.each([['con\u0000nulo'], ['con​ancho cero'], ['con nbsp'], ['con\ttab']])(
    'rechaza caracteres prohibidos en %j',
    (value) => {
      expect(normalizedRecordName(value)).toBeNull()
    },
  )
})

describe('recordNameKey', () => {
  it('ignora mayúsculas', () => {
    expect(recordNameKey('CABINA')).toBe(recordNameKey('cabina'))
  })

  it('unifica formas de compatibilidad NFKC', () => {
    expect(recordNameKey('ＡＢＣ')).toBe('abc')
  })

  it('unifica la forma descompuesta con la compuesta', () => {
    expect(recordNameKey('é')).toBe(recordNameKey('é'))
  })

  it('distingue nombres distintos', () => {
    expect(recordNameKey('Cabina 1')).not.toBe(recordNameKey('Cabina 2'))
  })
})

describe('requirePermission', () => {
  it('lanza unauthenticated sin sesión', () => {
    expect(() => requirePermission(() => null, 'resources.manage')).toThrow(
      expect.objectContaining({ code: unauthenticatedError().code }),
    )
  })

  it('lanza forbidden si la sesión no tiene ninguno de los permisos aceptados', () => {
    expect(() => requirePermission(() => userWith('clients.read'), 'resources.manage', 'catalog.write')).toThrow(
      expect.objectContaining({ code: forbiddenError().code }),
    )
  })

  it('lanza forbidden si la sesión no tiene permisos', () => {
    expect(() => requirePermission(() => userWith(), 'resources.manage')).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    )
  })

  it('acepta si tiene el primero de los permisos aceptados', () => {
    expect(() => requirePermission(() => userWith('resources.manage'), 'resources.manage', 'catalog.write')).not.toThrow()
  })

  it('acepta si tiene solo el último de los permisos aceptados', () => {
    expect(() => requirePermission(() => userWith('catalog.write'), 'resources.manage', 'catalog.write')).not.toThrow()
  })

  it('consulta la sesión en cada llamada', () => {
    let session: SessionUser | null = null
    const check = () => requirePermission(() => session, 'resources.manage')

    expect(check).toThrow()
    session = userWith('resources.manage')
    expect(check).not.toThrow()
  })
})

describe('toInstant', () => {
  it('formatea milisegundos como ISO 8601 UTC', () => {
    expect(toInstant(0)).toBe('1970-01-01T00:00:00.000Z')
    expect(toInstant(Date.UTC(2026, 10, 12, 9, 30, 15, 123))).toBe('2026-11-12T09:30:15.123Z')
  })
})

describe('nextRecordId', () => {
  it('devuelve 1 sin filas', () => {
    expect(nextRecordId([])).toBe(1)
  })

  it('devuelve el mayor id más uno sin importar el orden', () => {
    expect(nextRecordId([{ id: 2 }, { id: 9 }, { id: 4 }])).toBe(10)
  })

  it('no reutiliza el id de una fila intermedia faltante', () => {
    expect(nextRecordId([{ id: 1 }, { id: 3 }])).toBe(4)
  })
})

describe('replaceRecord', () => {
  const rows = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
    { id: 3, name: 'c' },
  ]

  it('sustituye solo la fila con el mismo id y conserva el orden', () => {
    const updated = { id: 2, name: 'nueva' }

    expect(replaceRecord(rows, updated)).toEqual([rows[0], updated, rows[2]])
  })

  it('conserva por identidad las filas que no cambian', () => {
    const result = replaceRecord(rows, { id: 2, name: 'nueva' })

    expect(result[0]).toBe(rows[0])
    expect(result[2]).toBe(rows[2])
  })

  it('no muta el arreglo original', () => {
    const snapshot = structuredClone(rows)

    replaceRecord(rows, { id: 1, name: 'otra' })

    expect(rows).toEqual(snapshot)
  })

  it('devuelve las mismas filas si el id no existe', () => {
    expect(replaceRecord(rows, { id: 99, name: 'x' })).toEqual(rows)
  })
})
