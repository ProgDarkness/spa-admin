import { describe, expect, it } from 'vitest'
import { appointmentFormSchema, appointmentMoveFormSchema } from './schemas'

const VALID_INPUT = { clientId: 1, serviceId: 2, resourceId: 3, startsAt: '2026-11-13T10:05', notes: null }
const VALID_FORM = { clientId: '1', serviceId: '2', resourceId: '3', startsAt: '2026-11-13T10:05', notes: '' }

function firstIssueOf(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.error?.issues[0]
}

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

describe('límite de notas', () => {
  const MAX_NOTES = 500
  const MESSAGE = 'Las notas no pueden superar 500 caracteres'

  it('acepta notas de exactamente 500 caracteres en el formulario', () => {
    const notes = 'a'.repeat(MAX_NOTES)

    expect(appointmentFormSchema.safeParse({ ...VALID_FORM, notes }).success).toBe(true)
  })

  it('rechaza notas de 501 caracteres con mensaje en español en el formulario', () => {
    const notes = 'a'.repeat(MAX_NOTES + 1)

    const form = appointmentFormSchema.safeParse({ ...VALID_FORM, notes })

    expect(firstIssueOf(form)).toMatchObject({ path: ['notes'], message: MESSAGE })
  })

  it('cuenta las notas ya recortadas', () => {
    const notes = `  ${'a'.repeat(MAX_NOTES)}  `

    expect(appointmentFormSchema.safeParse({ ...VALID_FORM, notes }).success).toBe(true)
  })
})
