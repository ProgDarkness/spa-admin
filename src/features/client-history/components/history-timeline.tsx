import { Badge } from '@/components/ui/badge'
import { PaymentsButton } from '@/features/payments/components/payments-button'
import { APPOINTMENT_STATUS_LABELS } from '@/features/appointments/labels'
import type { ClientHistoryEntry, Payment } from '@/lib/model'
import { formatCents } from '@/lib/money'

function PaymentSummary({ payment }: { payment: Payment }) {
  const amount = formatCents(payment.amountCents, payment.currency)
  if (payment.voidedAt === null) {
    return (
      <p data-voided="false" className="tabular-nums">
        {amount}
      </p>
    )
  }
  return (
    <p data-voided="true" className="tabular-nums">
      <s role="deletion">{amount}</s>
      <span className="ml-2 text-destructive">Anulado</span>
    </p>
  )
}

const STATUS_DOT_CLASSES: Record<ClientHistoryEntry['status'], string> = {
  scheduled: 'bg-status-scheduled',
  inProgress: 'bg-status-in-progress',
  completed: 'bg-status-completed',
  cancelled: 'bg-status-cancelled',
  noShow: 'bg-status-no-show',
}

function TimelineEntry({ entry }: { entry: ClientHistoryEntry }) {
  return (
    <li className="relative grid gap-1 rounded-md border border-border bg-card p-3 text-sm">
      <span
        aria-hidden="true"
        className={`absolute -left-[1.9rem] top-4 size-3 rounded-full border-2 border-background ${STATUS_DOT_CLASSES[entry.status]}`}
      />
      <p className="font-medium tabular-nums">{entry.startsAt.replace('T', ' ')}</p>
      <p>{`${entry.serviceName} · ${entry.resourceName}`}</p>
      <Badge variant="secondary" className="w-fit">
        {APPOINTMENT_STATUS_LABELS[entry.status]}
      </Badge>
      {entry.payments.length > 0 ? (
        <div role="group" aria-label="Pagos registrados" className="text-muted-foreground">
          {entry.payments.map((payment) => (
            <PaymentSummary key={payment.id} payment={payment} />
          ))}
        </div>
      ) : null}
      <PaymentsButton appointmentId={entry.id} />
    </li>
  )
}

export function HistoryTimeline({ entries }: { entries: readonly ClientHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div
        data-slot="empty-state"
        className="rounded-md border border-border bg-card p-8 text-center text-muted-foreground"
      >
        <p>Este cliente aún no tiene citas.</p>
      </div>
    )
  }
  return (
    <ol aria-label="Historial de citas" className="relative ml-6 grid gap-3 border-l border-border pl-6">
      {entries.map((entry) => (
        <TimelineEntry key={entry.id} entry={entry} />
      ))}
    </ol>
  )
}
