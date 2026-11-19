import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PaymentsButton } from '@/features/payments/components/payments-button'
import type { Appointment, AppointmentStatus } from '@/lib/model'
import { APPOINTMENT_STATUS_LABELS, timeOf, type AppointmentLabels } from '../labels'
import { AppointmentActions } from './appointment-actions'

const STATUS_ACCENT: Record<AppointmentStatus, string> = {
  scheduled: 'border-l-status-scheduled',
  inProgress: 'border-l-status-in-progress',
  completed: 'border-l-status-completed',
  cancelled: 'border-l-status-cancelled',
  noShow: 'border-l-status-no-show',
}

type AppointmentCardProps = {
  appointment: Appointment
  labels: AppointmentLabels
  canWrite: boolean
  onCancel(appointment: Appointment): void
  onMove(appointment: Appointment): void
}

export function AppointmentCard({ appointment, labels, canWrite, onCancel, onMove }: AppointmentCardProps) {
  const clientName = labels.clientNameOf(appointment.clientId)
  const canMove = canWrite && appointment.status === 'scheduled'
  return (
    <article
      aria-label={`Cita de ${clientName} a las ${timeOf(appointment.startsAt)}`}
      data-status={appointment.status}
      className={`grid gap-1 rounded-md border border-l-[3px] bg-card p-2 text-sm ${STATUS_ACCENT[appointment.status]}`}
    >
      <p className="font-medium">{`${timeOf(appointment.startsAt)} – ${timeOf(appointment.endsAt)}`}</p>
      <p>{clientName}</p>
      <p className="text-muted-foreground">{labels.serviceNameOf(appointment.serviceId)}</p>
      <Badge variant="secondary" className="w-fit">
        {APPOINTMENT_STATUS_LABELS[appointment.status]}
      </Badge>
      {canMove ? (
        <Button size="sm" variant="outline" className="w-fit" aria-label={`Mover cita de ${clientName}`} onClick={() => onMove(appointment)}>
          Mover
        </Button>
      ) : null}
      <PaymentsButton appointmentId={appointment.id} />
      <AppointmentActions appointment={appointment} clientName={clientName} canWrite={canWrite} onCancel={onCancel} />
    </article>
  )
}
