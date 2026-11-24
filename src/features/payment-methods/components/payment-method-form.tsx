'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { AppError, PaymentMethodInput } from '@/lib/model'
import { paymentMethodInputSchema } from '../schemas'

type PaymentMethodFormProps = {
  initialValue: PaymentMethodInput
  submitLabel: string
  onSubmit(input: PaymentMethodInput): Promise<AppError | null>
  onCancel(): void
}

function isNameFailure(error: AppError): boolean {
  return error.code === 'validation' && error.field === 'name'
}

export function PaymentMethodForm({ initialValue, submitLabel, onSubmit, onCancel }: PaymentMethodFormProps) {
  const [failure, setFailure] = useState<AppError | null>(null)
  const form = useForm<PaymentMethodInput>({
    resolver: zodResolver(paymentMethodInputSchema),
    defaultValues: { name: initialValue.name },
  })

  async function submit(input: PaymentMethodInput) {
    const error = await onSubmit(input)
    if (error && isNameFailure(error)) {
      setFailure(null)
      form.setError('name', { type: 'server', message: error.message })
      return
    }
    setFailure(error)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {failure ? (
          <p role="alert" data-tone="error" className="text-sm text-destructive">
            {failure.message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}
