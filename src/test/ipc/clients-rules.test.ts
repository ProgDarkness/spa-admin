import { describe, expect, it } from 'vitest'
import { searchKeyOf, searchTermOf, validPhone } from './clients-rules'

describe('validPhone', () => {
  it.each([
    ['0414-1234567', '0414-1234567'],
    ['  0414   1234567 ', '0414 1234567'],
    ['+58 414-1234567', '+58 414-1234567'],
    ['1234567', '1234567'],
    ['\u00A00414\u20031234567\u2003', '0414 1234567'],
    ['123456789012345', '123456789012345'],
  ])('acepta %j como %j', (raw, expected) => {
    expect(validPhone(raw)).toBe(expected)
  })

  it.each([
    [''],
    ['abc'],
    ['123456'],
    ['1234567890123456'],
    ['0414\t1234567'],
    ['0414\n1234567'],
    ['++584141234567'],
    ['0414.1234567'],
    ['0414-1234567 ext'],
    ['\uFEFF0414-1234567'],
    ['0414-1234567\uFEFF'],
    [`${'1 '.repeat(16)}1`],
  ])('rechaza %j', (raw) => {
    expect(validPhone(raw)).toBeNull()
  })

  it('acepta exactamente 32 caracteres y rechaza 33', () => {
    const thirtyTwo = `1234567${'-'.repeat(25)}`
    expect(thirtyTwo).toHaveLength(32)
    expect(validPhone(thirtyTwo)).toBe(thirtyTwo)
    expect(validPhone(`${thirtyTwo}3`)).toBeNull()
  })
})

describe('searchKeyOf', () => {
  it('concatena los cuatro campos, la cédula compacta y los dígitos del teléfono', () => {
    expect(searchKeyOf({ firstName: 'María', lastName: 'González', nationalId: 'V-12345678', phone: '0414-123 4567' })).toBe(
      'maria gonzalez v-12345678 v12345678 0414-123 4567 04141234567',
    )
  })

  it('no depende de tildes en ningún campo', () => {
    const accented = { firstName: 'Sofía', lastName: 'Ramírez', nationalId: 'V-24567890', phone: '0412-8901234' }
    const plain = { ...accented, firstName: 'Sofia', lastName: 'Ramirez' }

    expect(searchKeyOf(accented)).toBe(searchKeyOf(plain))
  })
})

describe('searchTermOf', () => {
  it('pliega tildes y mayúsculas y recorta', () => {
    expect(searchTermOf('María')).toBe('maria')
    expect(searchTermOf('  ana  ')).toBe('ana')
  })

  it('compacta consultas con forma de cédula o teléfono', () => {
    for (const raw of ['V12345678', 'V 12345678', 'v-12345678', 'V-12.345.678']) {
      expect(searchTermOf(raw)).toBe('v12345678')
    }
    expect(searchTermOf('12.345.678')).toBe('12345678')
    expect(searchTermOf('0414 1234567')).toBe('04141234567')
    expect(searchTermOf('+58 414-123')).toBe('58414123')
  })

  it('conserva espacios y guiones en consultas de texto', () => {
    expect(searchTermOf('maria gonzalez')).toBe('maria gonzalez')
    expect(searchTermOf('-')).toBe('-')
    expect(searchTermOf('ana 2')).toBe('ana 2')
  })

  it('recorta con la semántica de espacios Unicode de Rust: U+FEFF no es espacio', () => {
    expect(searchTermOf('\u00A0ana\u2003')).toBe('ana')
    expect(searchTermOf('\uFEFFana')).toBe('\uFEFFana')
  })

  it('conserva % y _ como texto literal', () => {
    expect(searchTermOf('%')).toBe('%')
    expect(searchTermOf('50%_off')).toBe('50%_off')
  })

  it('limita la consulta a cien caracteres', () => {
    expect(searchTermOf('a'.repeat(150))).toBe('a'.repeat(100))
    expect(searchTermOf('Á'.repeat(101))).toBe('a'.repeat(100))
  })

  it('devuelve vacío para consulta vacía o en blanco', () => {
    expect(searchTermOf('')).toBe('')
    expect(searchTermOf('   ')).toBe('')
  })
})
