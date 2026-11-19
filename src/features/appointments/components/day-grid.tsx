import { dateOf } from '@/lib/datetime'
import type { Appointment, Id, LocalDate, LocalDateTime, Resource } from '@/lib/model'
import { visibleResourcesFor } from '../grid-layout'
import type { AppointmentLabels } from '../labels'
import { ResourceColumn } from './resource-column'

type DayGridProps = {
  date: LocalDate
  resources: readonly Resource[]
  appointments: readonly Appointment[]
  labels: AppointmentLabels
  canWrite: boolean
  onCreateAt(resourceId: Id, startsAt: LocalDateTime): void
  onCancel(appointment: Appointment): void
  onMove(appointment: Appointment): void
}

export function DayGrid({ date, resources, appointments, ...columnProps }: DayGridProps) {
  const dayAppointments = appointments.filter((appointment) => dateOf(appointment.startsAt) === date)
  const columns = visibleResourcesFor(resources, dayAppointments)

  if (columns.length === 0) return <p className="text-sm text-muted-foreground">No hay recursos activos para mostrar</p>

  return (
    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-md border border-border bg-card p-3">
      {columns.map((resource) => (
        <ResourceColumn
          key={resource.id}
          date={date}
          resource={resource}
          appointments={dayAppointments.filter((appointment) => appointment.resourceId === resource.id)}
          {...columnProps}
        />
      ))}
    </div>
  )
}
