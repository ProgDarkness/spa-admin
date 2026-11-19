'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, type Control, type UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { AppError, Client, ClientInput, Id } from '@/lib/model'
import { appErrorOf } from '@/lib/result'
import { useCreateClient, useReactivateClient, useUpdateClient } from '../hooks'
import { clientInputSchema } from '../schemas'

export type ClientFormProps = { client?: Client | undefined; onSaved: (client: Client) => void }

type FieldSpec = { name: keyof ClientInput; label: string; autoComplete: string; inputMode?: 'tel' }

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: 'firstName', label: 'Nombre', autoComplete: 'given-name' },
  { name: 'lastName', label: 'Apellido', autoComplete: 'family-name' },
  { name: 'nationalId', label: 'Cédula', autoComplete: 'off' },
  { name: 'phone', label: 'Teléfono', autoComplete: 'tel', inputMode: 'tel' },
]

const EMPTY_VALUES: ClientInput = { firstName: '', lastName: '', nationalId: '', phone: '' }
const FORM_FIELDS: readonly string[] = FIELD_SPECS.map((spec) => spec.name)
const UNEXPECTED_ERROR_MESSAGE = 'No se pudo guardar el cliente'

function valuesOf(client: Client | undefined): ClientInput {
  if (!client) return EMPTY_VALUES
  return {
    firstName: client.firstName,
    lastName: client.lastName,
    nationalId: client.nationalId,
    phone: client.phone,
  }
}

function formFieldOf(error: AppError): keyof ClientInput | null {
  const field = error.field
  return field !== null && FORM_FIELDS.includes(field) ? (field as keyof ClientInput) : null
}

function useClientSubmission(client: Client | undefined, onSaved: (client: Client) => void, form: UseFormReturn<ClientInput>) {
  const createClient = useCreateClient()
  const updateClient = useUpdateClient()
  const reactivateClient = useReactivateClient()
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null)
  const [reactivableClientId, setReactivableClientId] = useState<Id | null>(null)

  function reportFailure(caught: unknown) {
    const error = appErrorOf(caught)
    const field = error ? formFieldOf(error) : null
    setReactivableClientId(error?.code === 'clientDeletedReactivate' ? (error.entityIds?.[0] ?? null) : null)
    if (error && field) {
      form.setError(field, { message: error.message })
      return
    }
    setFormErrorMessage(error?.message ?? UNEXPECTED_ERROR_MESSAGE)
  }

  async function submit(input: ClientInput) {
    setFormErrorMessage(null)
    setReactivableClientId(null)
    try {
      const saved = client
        ? await updateClient.mutateAsync({ id: client.id, input })
        : await createClient.mutateAsync(input)
      onSaved(saved)
    } catch (caught) {
      reportFailure(caught)
    }
  }

  async function reactivate(id: Id) {
    try {
      onSaved(await reactivateClient.mutateAsync(id))
    } catch (caught) {
      reportFailure(caught)
    }
  }

  return { formErrorMessage, reactivableClientId, submit, reactivate }
}

function ClientFields({ control }: { control: Control<ClientInput> }) {
  return FIELD_SPECS.map((spec) => (
    <FormField
      key={spec.name}
      control={control}
      name={spec.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{spec.label}</FormLabel>
          <FormControl>
            <Input autoComplete={spec.autoComplete} inputMode={spec.inputMode} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  ))
}

export function ClientForm({ client, onSaved }: ClientFormProps) {
  const form = useForm<ClientInput>({
    resolver: zodResolver(clientInputSchema),
    defaultValues: valuesOf(client),
  })
  const { formErrorMessage, reactivableClientId, submit, reactivate } = useClientSubmission(client, onSaved, form)

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
        <ClientFields control={form.control} />
        {formErrorMessage ? (
          <p role="alert" data-tone="error" className="text-sm text-destructive">
            {formErrorMessage}
          </p>
        ) : null}
        {reactivableClientId !== null ? (
          <Button type="button" variant="outline" onClick={() => reactivate(reactivableClientId)}>
            Reactivar cliente
          </Button>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Guardar cliente
        </Button>
      </form>
    </Form>
  )
}
