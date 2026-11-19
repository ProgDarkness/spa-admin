'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { useResources } from '@/features/resources/hooks'
import type { AppError, Appointment, AppointmentMove } from '@/lib/model'
import { fieldErrorOf, type AppointmentLabels } from '../labels'
import { appointmentMoveFormSchema, type AppointmentMoveFormValues } from '../schemas'
import { FailureAlert } from './failure-alert'
import { SelectFormField, TextFormField } from './form-fields'

type MoveDialogProps = {
  appointment: Appointment
  labels: AppointmentLabels
  onSubmit(move: AppointmentMove): Promise<AppError | null>
  onClose(): void
}

const FORM_FIELDS: readonly (keyof AppointmentMoveFormValues)[] = ['resourceId', 'startsAt']

function MoveFields({ control }: { control: Control<AppointmentMoveFormValues> }) {
  const resources = useResources({ includeInactive: false })
  return (
    <>
      <SelectFormField
        control={control}
        name="resourceId"
        label="Recurso"
        placeholder="Elegir recurso"
        options={(resources.data ?? []).map((resource) => ({ value: String(resource.id), label: resource.name }))}
      />
      <TextFormField control={control} name="startsAt" label="Fecha y hora" type="datetime-local" />
    </>
  )
}

export function MoveDialog({ appointment, labels, onSubmit, onClose }: MoveDialogProps) {
  const [failure, setFailure] = useState<AppError | null>(null)
  const form = useForm<AppointmentMoveFormValues>({
    resolver: zodResolver(appointmentMoveFormSchema, undefined, { raw: true }),
    defaultValues: { resourceId: String(appointment.resourceId), startsAt: appointment.startsAt },
  })

  async function submit(values: AppointmentMoveFormValues) {
    setFailure(null)
    const result = await onSubmit(appointmentMoveFormSchema.parse(values))
    setFailure(result)
    const failedField = fieldErrorOf(result, FORM_FIELDS)
    if (result && failedField) {
      form.setError(failedField as keyof AppointmentMoveFormValues, { message: result.message })
    }
    if (!result) onClose()
  }

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Mover cita de ${labels.clientNameOf(appointment.clientId)}`}</DialogTitle>
          <DialogDescription>Elige el nuevo recurso y la nueva hora.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
            <MoveFields control={form.control} />
            <FailureAlert failure={failure} formFields={FORM_FIELDS} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Mover
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
