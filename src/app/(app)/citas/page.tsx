'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AppointmentForm } from '@/features/appointments/components/appointment-form'
import { DayGrid } from '@/features/appointments/components/day-grid'
import { MoveDialog } from '@/features/appointments/components/move-dialog'
import { ViewToolbar } from '@/features/appointments/components/view-toolbar'
import { WeekGrid } from '@/features/appointments/components/week-grid'
import {
  useAppointments,
  useCreateAppointment,
  useMoveAppointment,
  useTransitionAppointment,
} from '@/features/appointments/hooks'
import { buildAppointmentLabels, type AppointmentLabels } from '@/features/appointments/labels'
import { periodRangeOf, type AgendaView } from '@/features/appointments/period'
import { useClients } from '@/features/clients/hooks'
import { useResources } from '@/features/resources/hooks'
import { useServices } from '@/features/catalog/hooks'
import { todayLocal } from '@/lib/datetime'
import type { AppError, Appointment, AppointmentInput, AppointmentMove, Id, LocalDate, LocalDateTime, Resource } from '@/lib/model'
import { failureOf } from '@/lib/result'
import { useCan } from '@/lib/session'

type CreationDraft = { resourceId: Id | null; startsAt: LocalDateTime }

const DEFAULT_START_TIME = '09:00'

function useAgendaViewState() {
  const [view, setView] = useState<AgendaView>('day')
  const [date, setDate] = useState(todayLocal)
  const [weekResourceId, setWeekResourceId] = useState<Id | null>(null)
  return { view, setView, date, setDate, weekResourceId, setWeekResourceId }
}

function useAgendaData(view: AgendaView, date: LocalDate, weekResourceId: Id | null) {
  const { from, to } = periodRangeOf(view, date)
  const appointments = useAppointments({ from, to, resourceId: view === 'week' ? weekResourceId : null })
  const resources = useResources({ includeInactive: true })
  const clients = useClients({ query: '', includeDeleted: true })
  const services = useServices({ includeInactive: true })
  const labels = buildAppointmentLabels(clients.data ?? [], services.data ?? [], resources.data ?? [])
  return { appointments, resources: resources.data ?? [], labels }
}

function useAgendaActions() {
  const createAppointment = useCreateAppointment()
  const moveAppointment = useMoveAppointment()
  const transitionAppointment = useTransitionAppointment()
  const [actionFailure, setActionFailure] = useState<AppError | null>(null)

  return {
    actionFailure,
    clearFailure: () => setActionFailure(null),
    create: async (input: AppointmentInput, onCreated: () => void) => {
      const failure = await failureOf(() => createAppointment.mutateAsync(input))
      if (!failure) {
        setActionFailure(null)
        onCreated()
      }
      return failure
    },
    moveTo: (appointment: Appointment) => async (move: AppointmentMove) => {
      const failure = await failureOf(() => moveAppointment.mutateAsync({ id: appointment.id, move }))
      if (!failure) setActionFailure(null)
      return failure
    },
    cancel: async (appointment: Appointment) =>
      setActionFailure(await failureOf(() => transitionAppointment.mutateAsync({ id: appointment.id, transition: 'cancel' }))),
  }
}

function AlertMessage({ error }: { error: { message: string } | null }) {
  if (!error) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  )
}

function AgendaHeader({ canWrite, onCreate }: { canWrite: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="font-serif text-3xl font-medium">Agenda</h1>
      {canWrite ? <Button onClick={onCreate}>Nueva cita</Button> : null}
    </div>
  )
}

type CreationDialogProps = {
  draft: CreationDraft
  onSubmit: (input: AppointmentInput) => Promise<AppError | null>
  onClose: () => void
}

function CreationDialog({ draft, onSubmit, onClose }: CreationDialogProps) {
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva cita</DialogTitle>
          <DialogDescription>Elige cliente, servicio, recurso y hora de inicio.</DialogDescription>
        </DialogHeader>
        <AppointmentForm initialValue={draft} onSubmit={onSubmit} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  )
}

type AgendaViewProps = {
  view: AgendaView
  date: LocalDate
  weekResourceId: Id | null
  appointments: readonly Appointment[]
  resources: readonly Resource[]
  labels: AppointmentLabels
  canWrite: boolean
  onWeekResourceChange: (resourceId: Id | null) => void
  onCreateAt: (resourceId: Id, startsAt: LocalDateTime) => void
  onCancel: (appointment: Appointment) => void
  onMove: (appointment: Appointment) => void
}

function AgendaBody({ view, date, weekResourceId, onWeekResourceChange, onCreateAt, ...shared }: AgendaViewProps) {
  if (view === 'day') return <DayGrid date={date} onCreateAt={onCreateAt} {...shared} />
  return (
    <WeekGrid date={date} selectedResourceId={weekResourceId} onResourceChange={onWeekResourceChange} {...shared} />
  )
}

export default function AppointmentsPage() {
  const canWrite = useCan('appointments.write')
  const { view, setView, date, setDate, weekResourceId, setWeekResourceId } = useAgendaViewState()
  const [creationDraft, setCreationDraft] = useState<CreationDraft | null>(null)
  const [movingAppointment, setMovingAppointment] = useState<Appointment | null>(null)
  const agenda = useAgendaData(view, date, weekResourceId)
  const actions = useAgendaActions()
  const changeView = (nextView: AgendaView) => {
    actions.clearFailure()
    setView(nextView)
  }
  const changeDate = (nextDate: LocalDate) => {
    actions.clearFailure()
    setDate(nextDate)
  }

  return (
    <section className="grid gap-4">
      <AgendaHeader
        canWrite={canWrite}
        onCreate={() => setCreationDraft({ resourceId: null, startsAt: `${date}T${DEFAULT_START_TIME}` })}
      />
      <ViewToolbar view={view} date={date} onViewChange={changeView} onDateChange={changeDate} />
      <AlertMessage error={agenda.appointments.isError ? agenda.appointments.error : null} />
      <AlertMessage error={actions.actionFailure} />
      <AgendaBody
        view={view}
        date={date}
        weekResourceId={weekResourceId}
        appointments={agenda.appointments.data ?? []}
        resources={agenda.resources}
        labels={agenda.labels}
        canWrite={canWrite}
        onWeekResourceChange={setWeekResourceId}
        onCreateAt={(resourceId, startsAt) => setCreationDraft({ resourceId, startsAt })}
        onCancel={actions.cancel}
        onMove={setMovingAppointment}
      />
      {creationDraft ? (
        <CreationDialog
          draft={creationDraft}
          onSubmit={(input) => actions.create(input, () => setCreationDraft(null))}
          onClose={() => setCreationDraft(null)}
        />
      ) : null}
      {movingAppointment ? (
        <MoveDialog
          key={movingAppointment.id}
          appointment={movingAppointment}
          labels={agenda.labels}
          onSubmit={actions.moveTo(movingAppointment)}
          onClose={() => setMovingAppointment(null)}
        />
      ) : null}
    </section>
  )
}
