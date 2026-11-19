import { NativeSelect } from '@/components/native-select'
import { Label } from '@/components/ui/label'
import { addDays, dateOf } from '@/lib/datetime'
import type { Appointment, Id, LocalDate, Resource } from '@/lib/model'
import type { AppointmentLabels } from '../labels'
import { periodRangeOf } from '../period'
import { WeekDaySection } from './week-day-section'

type WeekGridProps = {
  date: LocalDate
  resources: readonly Resource[]
  selectedResourceId: Id | null
  appointments: readonly Appointment[]
  labels: AppointmentLabels
  canWrite: boolean
  onResourceChange(resourceId: Id | null): void
  onCancel(appointment: Appointment): void
  onMove(appointment: Appointment): void
}

const DAYS_PER_WEEK = 7
const ALL_RESOURCES_VALUE = ''

type ResourceFilterProps = {
  resources: readonly Resource[]
  selectedResourceId: Id | null
  onResourceChange(resourceId: Id | null): void
}

function ResourceFilter({ resources, selectedResourceId, onResourceChange }: ResourceFilterProps) {
  return (
    <div className="grid max-w-xs gap-1">
      <Label htmlFor="week-resource">Recurso</Label>
      <NativeSelect
        id="week-resource"
        value={selectedResourceId === null ? ALL_RESOURCES_VALUE : String(selectedResourceId)}
        onChange={(event) => onResourceChange(event.target.value === ALL_RESOURCES_VALUE ? null : Number(event.target.value))}
      >
        <option value={ALL_RESOURCES_VALUE}>Todos los recursos</option>
        {resources.map((resource) => (
          <option key={resource.id} value={resource.id}>
            {resource.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

export function WeekGrid({
  date,
  resources,
  selectedResourceId,
  appointments,
  labels,
  canWrite,
  onResourceChange,
  onCancel,
  onMove,
}: WeekGridProps) {
  const { from } = periodRangeOf('week', date)
  const days = Array.from({ length: DAYS_PER_WEEK }, (_, offset) => addDays(from, offset))
  const selectableResources = resources.filter((resource) => resource.active || resource.id === selectedResourceId)

  return (
    <div className="grid gap-4">
      <ResourceFilter
        resources={selectableResources}
        selectedResourceId={selectedResourceId}
        onResourceChange={onResourceChange}
      />
      <div className="grid gap-3 md:grid-cols-7 md:divide-x md:divide-border">
        {days.map((day) => (
          <WeekDaySection
            key={day}
            day={day}
            appointments={appointments.filter((appointment) => dateOf(appointment.startsAt) === day)}
            labels={labels}
            canWrite={canWrite}
            onCancel={onCancel}
            onMove={onMove}
          />
        ))}
      </div>
    </div>
  )
}
