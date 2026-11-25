import type { ClientHistory } from '@/lib/model'
import { amountLine, formatMinutes } from '../format'

export type HistorySummaryProps = { history: ClientHistory }

export function HistorySummary({ history }: HistorySummaryProps) {
  const { paidByCurrency, collectedOnNonCompletedByCurrency, pendingByCurrency } = history
  return (
    <section aria-label="Resumen" aria-live="polite" className="grid gap-1 rounded-md border border-border bg-card p-4 text-sm tabular-nums">
      <p>{`Tiempo total en servicios completados: ${formatMinutes(history.totalMinutes)}`}</p>
      <p>{amountLine('Pagado en USD', paidByCurrency.USD, 'USD')}</p>
      <p>{amountLine('Pagado en VES', paidByCurrency.VES, 'VES')}</p>
      <p>{amountLine('Equivalente en USD de pagos en VES', history.vesUsdEquivalentOfCompleted, 'USD')}</p>
      <p>{amountLine('Cobrado en citas no completadas en USD', collectedOnNonCompletedByCurrency.USD, 'USD')}</p>
      <p>{amountLine('Cobrado en citas no completadas en VES', collectedOnNonCompletedByCurrency.VES, 'VES')}</p>
      <p>{amountLine('Cobros pendientes (citas programadas o en curso) en USD', pendingByCurrency.USD, 'USD')}</p>
      <p>{amountLine('Cobros pendientes (citas programadas o en curso) en VES', pendingByCurrency.VES, 'VES')}</p>
    </section>
  )
}
