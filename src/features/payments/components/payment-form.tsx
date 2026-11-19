'use client'

import { useEffect, useState } from 'react'
import { useForm, useWatch, type Control, type UseFormReturn } from 'react-hook-form'
import { NativeSelect } from '@/components/native-select'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useTodayRate } from '@/features/rates/hooks'
import { usePaymentMethods } from '@/features/catalog/hooks'
import type { PaymentMethod } from '@/lib/model'
import { appErrorOf } from '@/lib/result'
import { rateInputText } from '../domain'
import { useCreatePayment } from '../hooks'
import { paymentFormSchema, type PaymentFormValues } from '../schemas'

export type PaymentFormProps = { appointmentId: number; onSaved?: () => void }

type Feedback = { kind: 'saved' } | { kind: 'failed'; message: string } | null

const EMPTY_VALUES: PaymentFormValues = { methodId: '', currency: 'USD', amount: '', rate: '' }
const FORM_FIELDS = ['methodId', 'amount', 'rate'] as const
const UNEXPECTED_ERROR_MESSAGE = 'No se pudo registrar el pago'

function isFormField(name: unknown): name is (typeof FORM_FIELDS)[number] {
  return FORM_FIELDS.some((field) => field === name)
}

type PaymentFormApi = UseFormReturn<PaymentFormValues>

function useRateAutofill(form: PaymentFormApi, currency: PaymentFormValues['currency'], todayRateValue: number | null) {
  const isRateTouched = form.formState.dirtyFields.rate === true

  useEffect(() => {
    if (currency === 'VES' && todayRateValue !== null && !isRateTouched) {
      form.setValue('rate', rateInputText(todayRateValue))
    }
  }, [currency, todayRateValue, isRateTouched, form])
}

function usePaymentSubmission(appointmentId: number, onSaved: (() => void) | undefined, form: PaymentFormApi) {
  const [feedback, setFeedback] = useState<Feedback>(null)
  const createPayment = useCreatePayment()

  async function submit(values: PaymentFormValues) {
    setFeedback(null)
    const parsed = paymentFormSchema.safeParse(values)
    if (!parsed.success) {
      parsed.error.issues.forEach(({ path, message }) => {
        const [name] = path
        if (isFormField(name)) form.setError(name, { message })
      })
      return
    }
    try {
      await createPayment.mutateAsync({ appointmentId, ...parsed.data })
      form.setValue('amount', '')
      setFeedback({ kind: 'saved' })
      onSaved?.()
    } catch (caught) {
      setFeedback({ kind: 'failed', message: appErrorOf(caught)?.message ?? UNEXPECTED_ERROR_MESSAGE })
    }
  }

  return { feedback, submit, isPending: createPayment.isPending }
}

type PaymentFieldsProps = {
  control: Control<PaymentFormValues>
  activeMethods: readonly PaymentMethod[]
  currency: PaymentFormValues['currency']
}

function MethodFields({ control, activeMethods }: Pick<PaymentFieldsProps, 'control' | 'activeMethods'>) {
  return (
    <>
      <FormField
        control={control}
        name="methodId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Método de pago</FormLabel>
            <FormControl>
              <NativeSelect {...field}>
                <option value="">Selecciona un método</option>
                {activeMethods.map((method) => (
                  <option key={method.id} value={String(method.id)}>
                    {method.name}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="currency"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Moneda</FormLabel>
            <FormControl>
              <NativeSelect {...field}>
                <option value="USD">Dólares (USD)</option>
                <option value="VES">Bolívares (VES)</option>
              </NativeSelect>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

function AmountFields({ control, currency }: Pick<PaymentFieldsProps, 'control' | 'currency'>) {
  return (
    <>
      <FormField
        control={control}
        name="amount"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Monto</FormLabel>
            <FormControl>
              <Input inputMode="decimal" autoComplete="off" placeholder="0,00" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {currency === 'VES' ? (
        <FormField
          control={control}
          name="rate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tasa (Bs por USD)</FormLabel>
              <FormControl>
                <Input inputMode="decimal" autoComplete="off" placeholder="36,50" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </>
  )
}

function PaymentFields(props: PaymentFieldsProps) {
  return (
    <>
      <MethodFields control={props.control} activeMethods={props.activeMethods} />
      <AmountFields control={props.control} currency={props.currency} />
    </>
  )
}

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (feedback?.kind === 'failed') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {feedback.message}
      </p>
    )
  }
  if (feedback?.kind === 'saved') {
    return (
      <p role="status" className="text-sm">
        Pago registrado
      </p>
    )
  }
  return null
}

export function PaymentForm({ appointmentId, onSaved }: PaymentFormProps) {
  const methods = usePaymentMethods()
  const todayRate = useTodayRate()
  const form = useForm<PaymentFormValues>({ defaultValues: EMPTY_VALUES })
  const currency = useWatch({ control: form.control, name: 'currency' })
  const { feedback, submit, isPending } = usePaymentSubmission(appointmentId, onSaved, form)
  useRateAutofill(form, currency, todayRate.data?.rateBsPerUsdE4 ?? null)
  const isTodayRateMissing = currency === 'VES' && todayRate.data === null
  const activeMethods = (methods.data ?? []).filter((method) => method.active)

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
        <PaymentFields control={form.control} activeMethods={activeMethods} currency={currency} />
        {isTodayRateMissing ? (
          <p role="note" data-tone="warning" className="text-sm text-[var(--warning-foreground)]">
            Falta la tasa de hoy. Ingresa la tasa manualmente para registrar el pago en bolívares.
          </p>
        ) : null}
        <FeedbackMessage feedback={feedback} />
        <Button type="submit" disabled={isPending}>
          Registrar pago
        </Button>
      </form>
    </Form>
  )
}
