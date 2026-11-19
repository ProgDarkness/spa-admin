import { Button } from '@/components/ui/button'
import { useNowLocal } from '@/lib/use-now-local'
import type { Appointment, Id, LocalDate, LocalDateTime, Resource } from '@/lib/model'
import {
  appointmentBox,
  dayStartOf,
  durationMinOf,
  isOutsideAgendaHours,
  isSlotBlocked,
  nowLineOffset,
  SLOT_MINUTES,
  slotStartsOf,
  VISIBLE_SLOT_COUNT,
} from '../grid-layout'
import { timeOf, type AppointmentLabels } from '../labels'
import { AppointmentCard } from './appointment-card'
import { NowLine } from './now-line'

type ResourceColumnProps = {
  date: LocalDate
  resource: Resource
  appointments: readonly Appointment[]
  labels: AppointmentLabels
  canWrite: boolean
  onCreateAt(resourceId: Id, startsAt: LocalDateTime): void
  onCancel(appointment: Appointment): void
  onMove(appointment: Appointment): void
}

type CardsProps = Pick<ResourceColumnProps, 'labels' | 'canWrite' | 'onCancel' | 'onMove'> & {
  appointments: readonly Appointment[]
}

function Cards({ appointments, labels, canWrite, onCancel, onMove }: CardsProps) {
  return appointments.map((appointment) => (
    <AppointmentCard
      key={appointment.id}
      appointment={appointment}
      labels={labels}
      canWrite={canWrite}
      onCancel={onCancel}
      onMove={onMove}
    />
  ))
}

function SlotNowLine({ slotStart, now }: { slotStart: LocalDateTime; now: LocalDateTime }) {
  const offset = nowLineOffset(slotStart, now)
  return offset === null ? null : <NowLine offset={offset} />
}

function slotsCss(slots: number): string {
  return `calc(var(--slot-height) * ${slots})`
}

function AppointmentBoxes({ appointments, dayStart, ...cardProps }: CardsProps & { dayStart: LocalDateTime }) {
  return appointments.map((appointment) => {
    const box = appointmentBox(appointment.startsAt, durationMinOf(appointment), dayStart, SLOT_MINUTES)
    if (box === null) return null
    return (
      <div
        key={appointment.id}
        data-slot="appointment-box"
        style={{ top: slotsCss(box.topSlots), height: slotsCss(box.heightSlots) }}
        className="pointer-events-auto absolute inset-x-0 overflow-y-auto [&_article]:flex! [&_article]:min-h-full [&_article]:flex-wrap [&_article]:items-center [&_article]:content-start [&_article_p]:basis-full"
      >
        <Cards appointments={[appointment]} {...cardProps} />
      </div>
    )
  })
}

export function ResourceColumn({ date, resource, appointments, onCreateAt, ...cardProps }: ResourceColumnProps) {
  const outsideHours = appointments.filter((appointment) => isOutsideAgendaHours(appointment.startsAt))
  const inHours = appointments.filter((appointment) => !isOutsideAgendaHours(appointment.startsAt))
  const now = useNowLocal()
  const canWriteHere = cardProps.canWrite && resource.active

  return (
    <section aria-label={`Recurso ${resource.name}`} className="min-w-[80%] flex-1 snap-start md:min-w-56">
      <h2 className="mb-2 font-serif text-lg font-medium">{resource.name}</h2>
      <div data-slot="slot-track" data-slot-count={VISIBLE_SLOT_COUNT} className="relative">
        <ul>
          {slotStartsOf(date).map((slotStart) => (
            <li
              key={slotStart}
              aria-label={`Franja ${timeOf(slotStart)}`}
              className="group relative flex h-(--slot-height) items-start justify-between gap-2 border-t border-border pt-1"
            >
              <span data-slot="hour" className="font-serif text-xl tabular-nums text-muted-foreground">
                {timeOf(slotStart)}
              </span>
              <SlotNowLine slotStart={slotStart} now={now} />
              {canWriteHere && !isSlotBlocked(slotStart, resource.id, appointments) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-reveal="hover"
                  className="[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Crear cita en ${resource.name} a las ${timeOf(slotStart)}`}
                  onClick={() => onCreateAt(resource.id, slotStart)}
                >
                  +
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="pointer-events-none absolute inset-y-0 right-0 left-20">
          <AppointmentBoxes appointments={inHours} dayStart={dayStartOf(date)} {...cardProps} />
        </div>
      </div>
      {outsideHours.length > 0 ? (
        <ul>
          <li aria-label="Fuera de horario" className="grid gap-1 border-t border-border pt-1">
            <span className="text-xs text-muted-foreground">Fuera de horario</span>
            <Cards appointments={outsideHours} {...cardProps} />
          </li>
        </ul>
      ) : null}
    </section>
  )
}
