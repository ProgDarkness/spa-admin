import { dateOf } from '@/lib/datetime'
import { useNowLocal } from '@/lib/use-now-local'
import type { Appointment, LocalDate } from '@/lib/model'
import { isOutsideAgendaHours } from '../grid-layout'
import type { AppointmentLabels } from '../labels'
import { formatDayLabel } from '../period'
import { AppointmentCard } from './appointment-card'
import { NowLine } from './now-line'

type WeekDaySectionProps = {
  day: LocalDate
  appointments: readonly Appointment[]
  labels: AppointmentLabels
  canWrite: boolean
  onCancel(appointment: Appointment): void
  onMove(appointment: Appointment): void
}

type EntriesProps = Omit<WeekDaySectionProps, 'day'>

function Entries({ appointments, labels, canWrite, onCancel, onMove }: EntriesProps) {
  return appointments.map((appointment) => (
    <div key={appointment.id} className="grid gap-1">
      <p className="text-xs text-muted-foreground">{labels.resourceNameOf(appointment.resourceId)}</p>
      <AppointmentCard appointment={appointment} labels={labels} canWrite={canWrite} onCancel={onCancel} onMove={onMove} />
    </div>
  ))
}

export function WeekDaySection({ day, appointments, ...entryProps }: WeekDaySectionProps) {
  const isToday = dateOf(useNowLocal()) === day
  const sorted = appointments.toSorted((first, second) => first.startsAt.localeCompare(second.startsAt) || first.id - second.id)
  const outsideHours = sorted.filter((appointment) => isOutsideAgendaHours(appointment.startsAt))
  const inHours = sorted.filter((appointment) => !isOutsideAgendaHours(appointment.startsAt))
  return (
    <section aria-label={`Día ${formatDayLabel(day)}`} className="relative grid content-start gap-2 border-t border-border pt-2">
      <h2 className="font-serif text-base font-medium capitalize">{formatDayLabel(day)}</h2>
      {isToday ? <NowLine offset={0} /> : null}
      {sorted.length === 0 ? <p className="text-xs text-muted-foreground">Sin citas</p> : null}
      <Entries appointments={inHours} {...entryProps} />
      {outsideHours.length > 0 ? (
        <div role="group" aria-label="Fuera de horario" className="grid gap-2 border-t border-border pt-2">
          <p className="text-xs font-medium text-muted-foreground">Fuera de horario</p>
          <Entries appointments={outsideHours} {...entryProps} />
        </div>
      ) : null}
    </section>
  )
}
