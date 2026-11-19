'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { useServices } from '@/features/catalog/hooks'
import { useClients } from '@/features/clients/hooks'
import { useResources } from '@/features/resources/hooks'
import type { AppError, AppointmentInput, Id, LocalDateTime } from '@/lib/model'
import { fieldErrorOf } from '../labels'
import { appointmentFormSchema, type AppointmentFormValues } from '../schemas'
import { FailureAlert } from './failure-alert'
import { SelectFormField, TextFormField } from './form-fields'

type AppointmentFormProps = {
  initialValue: { resourceId: Id | null; startsAt: LocalDateTime }
  onSubmit(input: AppointmentInput): Promise<AppError | null>
  onCancel(): void
}

const FORM_FIELDS: readonly (keyof AppointmentFormValues)[] = ['clientId', 'serviceId', 'resourceId', 'startsAt', 'notes']

type SelectOption = { value: string; label: string }

function useAppointmentOptions() {
  const clients = useClients({ query: '', includeDeleted: false })
  const services = useServices({ includeInactive: false })
  const resources = useResources({ includeInactive: false })
  return {
    clients: (clients.data ?? []).map((client): SelectOption => ({
      value: String(client.id),
      label: `${client.firstName} ${client.lastName}`,
    })),
    services: (services.data ?? []).map((service): SelectOption => ({ value: String(service.id), label: service.name })),
    resources: (resources.data ?? []).map((resource): SelectOption => ({ value: String(resource.id), label: resource.name })),
  }
}

function AppointmentFields({ control }: { control: Control<AppointmentFormValues> }) {
  const options = useAppointmentOptions()
  return (
    <>
      <SelectFormField control={control} name="clientId" label="Cliente" placeholder="Elegir cliente" options={options.clients} />
      <SelectFormField control={control} name="serviceId" label="Servicio" placeholder="Elegir servicio" options={options.services} />
      <SelectFormField control={control} name="resourceId" label="Recurso" placeholder="Elegir recurso" options={options.resources} />
      <TextFormField control={control} name="startsAt" label="Fecha y hora" type="datetime-local" />
      <TextFormField control={control} name="notes" label="Notas" type="text" />
    </>
  )
}

export function AppointmentForm({ initialValue, onSubmit, onCancel }: AppointmentFormProps) {
  const [failure, setFailure] = useState<AppError | null>(null)
  const form = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentFormSchema, undefined, { raw: true }),
    defaultValues: {
      clientId: '',
      serviceId: '',
      resourceId: initialValue.resourceId === null ? '' : String(initialValue.resourceId),
      startsAt: initialValue.startsAt,
      notes: '',
    },
  })

  async function submit(values: AppointmentFormValues) {
    const input: AppointmentInput = appointmentFormSchema.parse(values)
    setFailure(null)
    const result = await onSubmit(input)
    setFailure(result)
    const failedField = fieldErrorOf(result, FORM_FIELDS)
    if (result && failedField) {
      form.setError(failedField as keyof AppointmentFormValues, { message: result.message })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
        <AppointmentFields control={form.control} />
        <FailureAlert failure={failure} formFields={FORM_FIELDS} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Crear cita
          </Button>
        </div>
      </form>
    </Form>
  )
}
