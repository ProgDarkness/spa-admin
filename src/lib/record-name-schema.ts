import { z } from 'zod'
import { countCodePoints, hasDisallowedTextCharacter, normalizeDisplayText } from './text'

const MAX_NAME_LENGTH = 80
const NAME_TOO_LONG_MESSAGE = `El nombre no puede superar ${MAX_NAME_LENGTH} caracteres`
const NAME_INVALID_CHARACTERS_MESSAGE = 'El nombre contiene caracteres no permitidos'

export function recordNameSchema(emptyMessage: string) {
  return z
    .string()
    .transform(normalizeDisplayText)
    .pipe(
      z
        .string()
        .min(1, emptyMessage)
        .refine((name) => countCodePoints(name) <= MAX_NAME_LENGTH, NAME_TOO_LONG_MESSAGE)
        .refine((name) => !hasDisallowedTextCharacter(name), NAME_INVALID_CHARACTERS_MESSAGE),
    )
}
