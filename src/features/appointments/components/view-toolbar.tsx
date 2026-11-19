import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { todayLocal } from '@/lib/datetime'
import type { LocalDate } from '@/lib/model'
import { formatPeriodLabel, shiftDate, type AgendaView } from '../period'

type ViewToolbarProps = {
  view: AgendaView
  date: LocalDate
  onViewChange(view: AgendaView): void
  onDateChange(date: LocalDate): void
}

const VIEW_OPTIONS: readonly { view: AgendaView; label: string }[] = [
  { view: 'day', label: 'Día' },
  { view: 'week', label: 'Semana' },
]

export function ViewToolbar({ view, date, onViewChange, onDateChange }: ViewToolbarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border pb-3">
      <div role="group" aria-label="Vista" className="flex gap-1">
        {VIEW_OPTIONS.map((option) => (
          <Button
            key={option.view}
            type="button"
            size="sm"
            variant={option.view === view ? 'default' : 'outline'}
            aria-pressed={option.view === view}
            onClick={() => onViewChange(option.view)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" onClick={() => onDateChange(shiftDate(view, date, -1))}>
          Anterior
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onDateChange(todayLocal())}>
          Hoy
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onDateChange(shiftDate(view, date, 1))}>
          Siguiente
        </Button>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="agenda-date">Fecha</Label>
        <Input
          id="agenda-date"
          type="date"
          value={date}
          onChange={(event) => (event.target.value === '' ? undefined : onDateChange(event.target.value))}
        />
      </div>
      <p role="status" className="font-serif text-lg capitalize">
        {formatPeriodLabel(view, date)}
      </p>
    </div>
  )
}
