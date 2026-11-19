import { describe, expect, it } from 'vitest'
import {
  appointmentFormSchema,
  appointmentInputSchema,
  appointmentMoveFormSchema,
  appointmentMoveSchema,
  appointmentRangeSchema,
} from './schemas'

const VALID_INPUT = { clientId: 1, serviceId: 2, resourceId: 3, startsAt: '2026-11-13T10:05', notes: null }
const VALID_FORM = { clientId: '1', serviceId: '2', resourceId: '3', startsAt: '2026-11-13T10:05', notes: '' }

function firstIssueOf(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.error?.issues[0]
}

describe('appointmentInputSchema', () => {
  it('acepta una entrada válida', () => {
    expect(appointmentInputSchema.parse(VALID_INPUT)).toEqual(VALID_INPUT)
  })

  it('normaliza notas vacías o en blanco a null y recorta el resto', () => {
    expect(appointmentInputSchema.parse({ ...VALID_INPUT, notes: '   ' }).notes).toBeNull()
    expect(appointmentInputSchema.parse({ ...VALID_INPUT, notes: '  traer bata ' }).notes).toBe('traer bata')
  })

  it.each(['clientId', 'serviceId', 'resourceId'] as const)('rechaza %s no entero o no positivo', (field) => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const result = appointmentInputSchema.safeParse({ ...VALID_INPUT, [field]: bad })
      expect(result.success).toBe(false)
      expect(firstIssueOf(result)?.path).toEqual([field])
    }
  })

  it.each(['', '2026-11-13', '2026-11-13 10:00', '2026-11-13T10:00:00', 'texto'])('rechaza startsAt con formato inválido %j', (startsAt) => {
    const result = appointmentInputSchema.safeParse({ ...VALID_INPUT, startsAt })
    expect(result.success).toBe(false)
    expect(firstIssueOf(result)?.path).toEqual(['startsAt'])
  })

  it.each(['2026-11-13T10:01', '2026-11-13T10:59', '2026-11-13T10:04'])('rechaza minutos que no son múltiplo de 5: %s', (startsAt) => {
    const result = appointmentInputSchema.safeParse({ ...VALID_INPUT, startsAt })
    expect(result.success).toBe(false)
    expect(firstIssueOf(result)?.message).toBe('La hora debe estar en bloques de 5 minutos')
  })

  it.each(['2026-02-30T10:00', '2026-13-01T10:00', '2026-11-13T25:00', '2026-11-13T10:60'])('rechaza fechas inexistentes: %s', (startsAt) => {
    expect(appointmentInputSchema.safeParse({ ...VALID_INPUT, startsAt }).success).toBe(false)
  })

  it('acepta los bordes 00:00 y 23:55', () => {
    expect(appointmentInputSchema.safeParse({ ...VALID_INPUT, startsAt: '2026-11-13T00:00' }).success).toBe(true)
    expect(appointmentInputSchema.safeParse({ ...VALID_INPUT, startsAt: '2026-11-13T23:55' }).success).toBe(true)
  })

  it('rechaza notas que no son texto ni null', () => {
    expect(appointmentInputSchema.safeParse({ ...VALID_INPUT, notes: 5 }).success).toBe(false)
    expect(appointmentInputSchema.safeParse({ ...VALID_INPUT, notes: undefined }).success).toBe(false)
  })
})

describe('appointmentMoveSchema', () => {
  it('acepta un movimiento válido', () => {
    expect(appointmentMoveSchema.parse({ startsAt: '2026-11-14T09:30', resourceId: 2 })).toEqual({
      startsAt: '2026-11-14T09:30',
      resourceId: 2,
    })
  })

  it('rechaza minutos inválidos y recurso inválido', () => {
    expect(appointmentMoveSchema.safeParse({ startsAt: '2026-11-14T09:31', resourceId: 2 }).success).toBe(false)
    expect(appointmentMoveSchema.safeParse({ startsAt: '2026-11-14T09:30', resourceId: 0 }).success).toBe(false)
  })
})

describe('appointmentFormSchema', () => {
  it('transforma los textos del formulario en AppointmentInput', () => {
    expect(appointmentFormSchema.parse(VALID_FORM)).toEqual(VALID_INPUT)
  })

  it('conserva las notas recortadas', () => {
    expect(appointmentFormSchema.parse({ ...VALID_FORM, notes: ' hola ' }).notes).toBe('hola')
  })

  it.each([
    ['clientId', 'Selecciona un cliente'],
    ['serviceId', 'Selecciona un servicio'],
    ['resourceId', 'Selecciona un recurso'],
  ] as const)('exige %s vacío con mensaje en español', (field, message) => {
    const result = appointmentFormSchema.safeParse({ ...VALID_FORM, [field]: '' })
    expect(result.success).toBe(false)
    expect(firstIssueOf(result)).toMatchObject({ path: [field], message })
  })

  it('rechaza identificadores no numéricos', () => {
    expect(appointmentFormSchema.safeParse({ ...VALID_FORM, clientId: 'abc' }).success).toBe(false)
    expect(appointmentFormSchema.safeParse({ ...VALID_FORM, clientId: '1.5' }).success).toBe(false)
  })

  it('exige fecha y hora válidas', () => {
    const result = appointmentFormSchema.safeParse({ ...VALID_FORM, startsAt: '' })
    expect(result.success).toBe(false)
    expect(firstIssueOf(result)).toMatchObject({ path: ['startsAt'], message: 'Ingresa fecha y hora válidas' })
  })
})

describe('appointmentMoveFormSchema', () => {
  it('transforma los textos en AppointmentMove', () => {
    expect(appointmentMoveFormSchema.parse({ resourceId: '2', startsAt: '2026-11-14T09:30' })).toEqual({
      resourceId: 2,
      startsAt: '2026-11-14T09:30',
    })
  })

  it('exige recurso y fecha válidos', () => {
    expect(appointmentMoveFormSchema.safeParse({ resourceId: '', startsAt: '2026-11-14T09:30' }).success).toBe(false)
    expect(appointmentMoveFormSchema.safeParse({ resourceId: '2', startsAt: '2026-11-14T09:31' }).success).toBe(false)
  })
})

describe('appointmentRangeSchema', () => {
  it('acepta rangos de un día y con recurso', () => {
    expect(appointmentRangeSchema.safeParse({ from: '2026-11-12', to: '2026-11-12', resourceId: 1 }).success).toBe(true)
  })

  it('rechaza fechas inexistentes y rangos invertidos', () => {
    expect(appointmentRangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-01', resourceId: null }).success).toBe(false)
    expect(appointmentRangeSchema.safeParse({ from: '2026-11-13', to: '2026-11-12', resourceId: null }).success).toBe(false)
  })
})

describe('límite de notas', () => {
  const MAX_NOTES = 500
  const MESSAGE = 'Las notas no pueden superar 500 caracteres'

  it('acepta notas de exactamente 500 caracteres en la entrada y el formulario', () => {
    const notes = 'a'.repeat(MAX_NOTES)

    expect(appointmentInputSchema.safeParse({ ...VALID_INPUT, notes }).success).toBe(true)
    expect(appointmentFormSchema.safeParse({ ...VALID_FORM, notes }).success).toBe(true)
  })

  it('rechaza notas de 501 caracteres con mensaje en español en la entrada y el formulario', () => {
    const notes = 'a'.repeat(MAX_NOTES + 1)

    const input = appointmentInputSchema.safeParse({ ...VALID_INPUT, notes })
    const form = appointmentFormSchema.safeParse({ ...VALID_FORM, notes })

    expect(firstIssueOf(input)).toMatchObject({ path: ['notes'], message: MESSAGE })
    expect(firstIssueOf(form)).toMatchObject({ path: ['notes'], message: MESSAGE })
  })

  it('cuenta las notas ya recortadas', () => {
    const notes = `  ${'a'.repeat(MAX_NOTES)}  `

    expect(appointmentInputSchema.safeParse({ ...VALID_INPUT, notes }).success).toBe(true)
    expect(appointmentFormSchema.safeParse({ ...VALID_FORM, notes }).success).toBe(true)
  })
})
