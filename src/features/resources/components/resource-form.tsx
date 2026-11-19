'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AppError, ResourceInput, ResourceKind } from '@/lib/model'
import { RESOURCE_KIND_LABELS, resourceInputSchema } from '../schemas'

type ResourceFormProps = {
  initialValue: ResourceInput
  submitLabel: string
  onSubmit(input: ResourceInput): Promise<AppError | null>
  onCancel(): void
}

const KINDS = Object.keys(RESOURCE_KIND_LABELS) as ResourceKind[]

function ResourceFields({ control }: { control: Control<ResourceInput> }) {
  return (
    <>
      <FormField
        control={control}
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
      <FormField
        control={control}
        name="kind"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tipo</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {RESOURCE_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

export function ResourceForm({ initialValue, submitLabel, onSubmit, onCancel }: ResourceFormProps) {
  const [failure, setFailure] = useState<AppError | null>(null)
  const form = useForm<ResourceInput>({
    resolver: zodResolver(resourceInputSchema),
    defaultValues: { name: initialValue.name, kind: initialValue.kind },
  })

  async function submit(input: ResourceInput) {
    setFailure(await onSubmit(input))
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
        <ResourceFields control={form.control} />
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
