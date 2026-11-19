'use client'

import { Badge } from '@/components/ui/badge'
import type { ClientHistory, Id } from '@/lib/model'
import { appErrorOf } from '@/lib/result'
import { useClientHistory } from '../hooks'
import { ClientNotFound } from './client-not-found'
import { HistorySummary } from './history-summary'
import { HistoryTimeline } from './history-timeline'

export type ClientHistoryViewProps = { clientId: Id }

const FORBIDDEN_MESSAGE = 'No tienes permiso para ver pagos ni el historial de este cliente'
const LOAD_FAILED_MESSAGE = 'No se pudo cargar la ficha del cliente'

function ClientHeader({ history }: { history: ClientHistory }) {
  const { client } = history
  return (
    <header className="grid gap-1">
      <div className="flex items-center gap-2">
        <h1 className="font-serif text-2xl font-semibold">{`${client.firstName} ${client.lastName}`}</h1>
        {client.deletedAt !== null ? <Badge variant="secondary">Eliminado</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">{client.nationalId}</p>
      <p className="text-sm text-muted-foreground">{client.phone}</p>
    </header>
  )
}

function failureMessageOf(error: unknown): string {
  const appError = appErrorOf(error)
  return appError?.code === 'forbidden' ? FORBIDDEN_MESSAGE : (appError?.message ?? LOAD_FAILED_MESSAGE)
}

export function ClientHistoryView({ clientId }: ClientHistoryViewProps) {
  const history = useClientHistory(clientId)

  if (history.isError) {
    if (appErrorOf(history.error)?.code === 'notFound') return <ClientNotFound />
    return (
      <p role="alert" className="text-sm text-destructive">
        {failureMessageOf(history.error)}
      </p>
    )
  }
  if (!history.data) return <p>Cargando ficha…</p>

  return (
    <div className="grid gap-6">
      <ClientHeader history={history.data} />
      <HistorySummary history={history.data} />
      <HistoryTimeline entries={history.data.entries} />
    </div>
  )
}
