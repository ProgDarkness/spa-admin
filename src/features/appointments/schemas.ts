import { z } from 'zod'
import { addMinutes, isExistingDate, LOCAL_DATE_TIME_PATTERN } from '@/lib/datetime'
import type { AppointmentInput, AppointmentMove, AppointmentRange, Id } from '@/lib/model'

export const START_STEP_MIN = 5

const INVALID_DATE_TIME_MESSAGE = 'Ingresa fecha y hora válidas'
const START_STEP_MESSAGE = `La hora debe estar en bloques de ${START_STEP_MIN} minutos`
const MAX_NOTES_LENGTH = 500
const NOTES_TOO_LONG_MESSAGE = `Las notas no pueden superar ${MAX_NOTES_LENGTH} caracteres`
const WHOLE_NUMBER_PATTERN = /^\d+$/
const MINUTES_START_INDEX = 'YYYY-MM-DDTHH:'.length

const idSchema = z.number().int().positive()

function isExistingDateTime(startsAt: string): boolean {
  return LOCAL_DATE_TIME_PATTERN.test(startsAt) && addMinutes(startsAt, 0) === startsAt
}

function minutesOf(startsAt: string): number {
  return Number(startsAt.slice(MINUTES_START_INDEX))
}

const startsAtSchema = z
  .string()
  .refine(isExistingDateTime, INVALID_DATE_TIME_MESSAGE)
  .refine((startsAt) => !isExistingDateTime(startsAt) || minutesOf(startsAt) % START_STEP_MIN === 0, START_STEP_MESSAGE)

const notesTextSchema = z.string().trim().max(MAX_NOTES_LENGTH, NOTES_TOO_LONG_MESSAGE)

function emptyToNull(text: string): string | null {
  return text === '' ? null : text
}

const notesSchema = notesTextSchema.nullable().transform((notes) => emptyToNull(notes ?? ''))

export const appointmentInputSchema = z.object({
  clientId: idSchema,
  serviceId: idSchema,
  resourceId: idSchema,
  startsAt: startsAtSchema,
  notes: notesSchema,
}) satisfies z.ZodType<AppointmentInput>

export const appointmentMoveSchema = z.object({
  startsAt: startsAtSchema,
  resourceId: idSchema,
}) satisfies z.ZodType<AppointmentMove>

const INVALID_DATE_MESSAGE = 'Ingresa una fecha válida'
const INVERTED_RANGE_MESSAGE = 'La fecha final no puede ser anterior a la inicial'

const dateSchema = z.string().refine(isExistingDate, INVALID_DATE_MESSAGE)

export const appointmentRangeSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    resourceId: idSchema.nullable(),
  })
  .refine((range) => range.from <= range.to, {
    path: ['to'],
    message: INVERTED_RANGE_MESSAGE,
  }) satisfies z.ZodType<AppointmentRange>

export type AppointmentFormValues = {
  clientId: string
  serviceId: string
  resourceId: string
  startsAt: string
  notes: string
}

function idTextSchema(missingMessage: string) {
  return z.string().transform((text, context): Id => {
    const trimmed = text.trim()
    if (WHOLE_NUMBER_PATTERN.test(trimmed) && Number(trimmed) > 0) return Number(trimmed)
    context.issues.push({ code: 'custom', message: missingMessage, input: text })
    return z.NEVER
  })
}

export const appointmentFormSchema = z
  .object({
    clientId: idTextSchema('Selecciona un cliente'),
    serviceId: idTextSchema('Selecciona un servicio'),
    resourceId: idTextSchema('Selecciona un recurso'),
    startsAt: startsAtSchema,
    notes: notesTextSchema.transform(emptyToNull),
  })
  .transform((values): AppointmentInput => values) satisfies z.ZodType<AppointmentInput, AppointmentFormValues>

export type AppointmentMoveFormValues = { resourceId: string; startsAt: string }

export const appointmentMoveFormSchema = z
  .object({
    resourceId: idTextSchema('Selecciona un recurso'),
    startsAt: startsAtSchema,
  })
  .transform((values): AppointmentMove => values) satisfies z.ZodType<AppointmentMove, AppointmentMoveFormValues>
