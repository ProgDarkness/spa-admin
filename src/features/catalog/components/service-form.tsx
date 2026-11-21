import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { AppError, Service, ServiceInput } from '@/lib/model'
import { appErrorOf } from '@/lib/result'
import { useCreateService, useUpdateService } from '../hooks'
import { serviceFormSchema, type ServiceFormValues } from '../schemas'

export type ServiceFormProps = { service: Service | null; onSaved(): void; onCancel(): void }

const UNEXPECTED_ERROR_MESSAGE = 'No se pudo guardar el servicio'
const FORM_FIELD_BY_BACKEND_FIELD: Readonly<Record<string, keyof ServiceFormValues>> = {
  name: 'name',
  priceCents: 'price',
  durationMin: 'durationMin',
}
const EMPTY_VALUES: ServiceFormValues = { name: '', price: '', durationMin: '' }

function formFieldOf(error: AppError): keyof ServiceFormValues | undefined {
  const backendField = error.code === 'validation' ? error.field : null
  return backendField !== null && Object.hasOwn(FORM_FIELD_BY_BACKEND_FIELD, backendField)
    ? FORM_FIELD_BY_BACKEND_FIELD[backendField]
    : undefined
}

function valuesOf(service: Service | null): ServiceFormValues {
  if (!service) return EMPTY_VALUES
  return {
    name: service.name,
    price: (service.priceCents / 100).toFixed(2),
    durationMin: String(service.durationMin),
  }
}

function ServiceFields({ control }: { control: Control<ServiceFormValues> }) {
  return (
    <>
      <FormField
        control={control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nombre</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="price"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Precio (USD)</FormLabel>
            <FormControl>
              <Input inputMode="decimal" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="durationMin"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Duración (minutos)</FormLabel>
            <FormControl>
              <Input inputMode="numeric" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

export function ServiceForm({ service, onSaved, onCancel }: ServiceFormProps) {
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  const create = useCreateService()
  const update = useUpdateService()
  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema, undefined, { raw: true }),
    defaultValues: valuesOf(service),
  })

  async function submit(values: ServiceFormValues) {
    setSaveErrorMessage(null)
    const input: ServiceInput = serviceFormSchema.parse(values)
    try {
      await (service ? update.mutateAsync({ id: service.id, input }) : create.mutateAsync(input))
      onSaved()
    } catch (caught) {
      reportSaveFailure(appErrorOf(caught))
    }
  }

  function reportSaveFailure(error: AppError | null) {
    const formField = error ? formFieldOf(error) : undefined
    if (error && formField) return form.setError(formField, { type: 'server', message: error.message })
    setSaveErrorMessage(error?.message ?? UNEXPECTED_ERROR_MESSAGE)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
        <ServiceFields control={form.control} />
        {saveErrorMessage ? (
          <p role="alert" data-tone="error" className="text-sm text-destructive">
            {saveErrorMessage}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {service ? 'Guardar cambios' : 'Crear servicio'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
