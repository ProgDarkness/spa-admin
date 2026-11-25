import { z } from 'zod'
import { addMinutes, LOCAL_DATE_TIME_PATTERN } from '@/lib/datetime'
import type { AppointmentInput, AppointmentMove, Id } from '@/lib/model'

export const START_STEP_MIN = 5

const INVALID_DATE_TIME_MESSAGE = 'Ingresa fecha y hora válidas'
const START_STEP_MESSAGE = `La hora debe estar en bloques de ${START_STEP_MIN} minutos`
const MAX_NOTES_LENGTH = 500
const NOTES_TOO_LONG_MESSAGE = `Las notas no pueden superar ${MAX_NOTES_LENGTH} caracteres`
const WHOLE_NUMBER_PATTERN = /^\d+$/
const MINUTES_START_INDEX = 'YYYY-MM-DDTHH:'.length

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
