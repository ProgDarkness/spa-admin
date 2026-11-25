'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch, type Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { todayLocal } from '@/lib/datetime'
import type { AppError } from '@/lib/model'
import { formatRateE4Fixed, parseRateE4 } from '@/lib/money'
import { appErrorOf } from '@/lib/result'
import { useUpsertRate } from '../hooks'
import { rateFormFieldsSchema, rateFormSchema, type RateFormValues } from '../schemas'

const RATE_PREVIEW_PREFIX = 'Se guardará como '
const RATE_PREVIEW_SUFFIX = ' Bs por USD'

type Feedback = { kind: 'saved' } | { kind: 'failed'; message: string } | null

const FORM_FIELD_BY_BACKEND_FIELD: Readonly<Record<string, keyof RateFormValues>> = {
  date: 'date',
  rateBsPerUsdE4: 'rateText',
}

function formFieldOf(error: AppError): keyof RateFormValues | undefined {
  const backendField = error.code === 'validation' ? error.field : null
  return backendField !== null && Object.hasOwn(FORM_FIELD_BY_BACKEND_FIELD, backendField)
    ? FORM_FIELD_BY_BACKEND_FIELD[backendField]
    : undefined
}

function ratePreviewMessage(rateText: string): string | null {
  const rate = parseRateE4(rateText)
  return rate === null ? null : `${RATE_PREVIEW_PREFIX}${formatRateE4Fixed(rate)}${RATE_PREVIEW_SUFFIX}`
}

function RatePreview({ control }: { control: Control<RateFormValues> }) {
  const message = ratePreviewMessage(useWatch({ control, name: 'rateText' }))
  return message === null ? null : <FormDescription>{message}</FormDescription>
}

function RateFields({ control }: { control: Control<RateFormValues> }) {
  return (
    <>
      <FormField
        control={control}
        name="date"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Fecha</FormLabel>
            <FormControl>
              <Input type="date" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="rateText"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tasa (Bs por USD)</FormLabel>
            <FormControl>
              <Input inputMode="decimal" autoComplete="off" placeholder="36,50" {...field} />
            </FormControl>
            <RatePreview control={control} />
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

export function RateForm() {
  const upsertRate = useUpsertRate()
  const [feedback, setFeedback] = useState<Feedback>(null)
  const form = useForm<RateFormValues>({
    resolver: zodResolver(rateFormFieldsSchema),
    defaultValues: { date: todayLocal(), rateText: '' },
  })

  async function submit(values: RateFormValues) {
    setFeedback(null)
    try {
      await upsertRate.mutateAsync(rateFormSchema.parse(values))
      setFeedback({ kind: 'saved' })
    } catch (caught) {
      const error = appErrorOf(caught)
      const formField = error ? formFieldOf(error) : undefined
      if (error && formField) {
        form.setError(formField, { type: 'server', message: error.message })
        return
      }
      setFeedback({ kind: 'failed', message: error?.message ?? 'No se pudo guardar la tasa' })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid w-full max-w-sm gap-4" noValidate>
        <RateFields control={form.control} />
        {feedback?.kind === 'failed' ? (
          <p role="alert" data-tone="error" className="text-sm text-destructive">
            {feedback.message}
          </p>
        ) : null}
        {feedback?.kind === 'saved' ? (
          <p role="status" className="text-sm text-muted-foreground">
            Tasa guardada
          </p>
        ) : null}
        <Button type="submit" disabled={upsertRate.isPending}>
          Guardar tasa
        </Button>
      </form>
    </Form>
  )
}
