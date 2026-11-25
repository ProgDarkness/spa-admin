import { z } from 'zod'
import type { PaymentMethodInput } from '@/lib/model'
import { recordNameSchema } from '@/lib/record-name-schema'

const NAME_MESSAGE = 'Ingresa el nombre del método de pago'

export const paymentMethodInputSchema = z.object({
  name: recordNameSchema(NAME_MESSAGE),
}) satisfies z.ZodType<PaymentMethodInput>
