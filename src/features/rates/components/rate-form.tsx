'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { todayLocal } from '@/lib/datetime'
import { appErrorOf } from '@/lib/result'
import { useUpsertRate } from '../hooks'
import { rateFormFieldsSchema, rateFormSchema, type RateFormValues } from '../schemas'

type Feedback = { kind: 'saved' } | { kind: 'failed'; message: string } | null

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
      setFeedback({ kind: 'failed', message: appErrorOf(caught)?.message ?? 'No se pudo guardar la tasa' })
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
