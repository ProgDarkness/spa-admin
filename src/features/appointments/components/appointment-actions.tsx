import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNowLocal } from '@/lib/use-now-local'
import type { AppError, Appointment, AppointmentTransition } from '@/lib/model'
import { UNEXPECTED_ERROR, appErrorOf } from '@/lib/result'
import { useCan } from '@/lib/session'
import { useTransitionAppointment } from '../hooks'
import { availableTransitions } from '../rules'
import { FailureAlert } from './failure-alert'

type AppointmentActionsProps = {
  appointment: Appointment
  clientName: string
  canWrite: boolean
  onCancel(appointment: Appointment): void
}

type ActionPresentation = { label: string; ariaVerb: string; variant: 'default' | 'outline' | 'destructive' }

const ACTION_PRESENTATION: Record<AppointmentTransition, ActionPresentation> = {
  start: { label: 'Iniciar', ariaVerb: 'Iniciar', variant: 'default' },
  complete: { label: 'Completar', ariaVerb: 'Completar', variant: 'default' },
  markNoShow: { label: 'No asistió', ariaVerb: 'Marcar no asistió', variant: 'outline' },
  cancel: { label: 'Cancelar', ariaVerb: 'Cancelar', variant: 'destructive' },
  reopen: { label: 'Reabrir', ariaVerb: 'Reabrir', variant: 'outline' },
}

export function AppointmentActions({ appointment, clientName, canWrite, onCancel }: AppointmentActionsProps) {
  const now = useNowLocal()
  const canReopen = useCan('appointments.reopen')
  const transitionAppointment = useTransitionAppointment()
  const [failure, setFailure] = useState<AppError | null>(null)
  const transitions = canWrite ? availableTransitions(appointment, now, canReopen) : []

  async function runTransition(transition: AppointmentTransition) {
    if (transition === 'cancel') return onCancel(appointment)
    try {
      await transitionAppointment.mutateAsync({ id: appointment.id, transition })
      setFailure(null)
    } catch (caught) {
      setFailure(appErrorOf(caught) ?? UNEXPECTED_ERROR)
    }
  }

  if (transitions.length === 0) return null
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {transitions.map((transition) => (
          <Button
            key={transition}
            size="sm"
            variant={ACTION_PRESENTATION[transition].variant}
            aria-label={`${ACTION_PRESENTATION[transition].ariaVerb} cita de ${clientName}`}
            onClick={() => runTransition(transition)}
          >
            {ACTION_PRESENTATION[transition].label}
          </Button>
        ))}
      </div>
      <FailureAlert failure={failure} formFields={[]} />
    </>
  )
}
