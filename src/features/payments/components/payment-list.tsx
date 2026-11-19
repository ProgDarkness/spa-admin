'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { usePaymentMethods } from '@/features/catalog/hooks'
import type { Id, Payment } from '@/lib/model'
import { formatCents, formatRateE4 } from '@/lib/money'
import { appErrorOf } from '@/lib/result'
import { useCan } from '@/lib/session'
import { sumActivePayments, usdTotalOfActivePayments } from '../domain'
import { usePayments } from '../hooks'
import { VoidDialog } from './void-dialog'

const METHOD_LOADING_LABEL = '…'
const DELETED_METHOD_LABEL = 'Método eliminado'

export type PaymentListProps = { appointmentId: Id }

type PaymentItemProps = {
  payment: Payment
  methodName: string
  canVoid: boolean
  onVoid: (payment: Payment) => void
}

function PaymentItem({ payment, methodName, canVoid, onVoid }: PaymentItemProps) {
  const amount = formatCents(payment.amountCents, payment.currency)
  const isVoided = payment.voidedAt !== null
  return (
    <li
      data-voided={isVoided ? 'true' : 'false'}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
    >
      <div className="grid gap-0.5">
        <p>
          {isVoided ? <s role="deletion" className="font-medium tabular-nums">{amount}</s> : <span className="font-medium tabular-nums">{amount}</span>}
          <span>{` · ${methodName}`}</span>
        </p>
        {payment.currency === 'VES' && payment.rateBsPerUsdE4 !== null ? (
          <p className="text-muted-foreground">
            {`Tasa ${formatRateE4(payment.rateBsPerUsdE4)} · ≈ ${formatCents(payment.usdEquivalentCents, 'USD')}`}
          </p>
        ) : null}
        <p className="text-muted-foreground">{payment.paidAt.replace('T', ' ')}</p>
        {isVoided ? <p className="text-destructive">{`Anulado: ${payment.voidReason ?? ''}`}</p> : null}
      </div>
      {!isVoided && canVoid ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onVoid(payment)}>
          {`Anular pago de ${amount}`}
        </Button>
      ) : null}
    </li>
  )
}

function PaymentTotals({ payments }: { payments: readonly Payment[] }) {
  const totals = sumActivePayments(payments)
  return (
    <div role="group" aria-label="Totales cobrados" className="grid gap-0.5 border-t border-border pt-3 text-sm font-medium tabular-nums">
      <p>{`Total USD: ${formatCents(totals.USD, 'USD')}`}</p>
      <p>{`Total VES: ${formatCents(totals.VES, 'VES')}`}</p>
      <p>{`Total equivalente en USD: ${formatCents(usdTotalOfActivePayments(payments), 'USD')}`}</p>
    </div>
  )
}

export function PaymentList({ appointmentId }: PaymentListProps) {
  const [voiding, setVoiding] = useState<Payment | null>(null)
  const payments = usePayments(appointmentId)
  const methods = usePaymentMethods()
  const canVoid = useCan('payments.write')

  if (payments.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {appErrorOf(payments.error)?.message ?? 'No se pudieron cargar los pagos'}
      </p>
    )
  }
  if (!payments.data) return <p className="text-sm">Cargando pagos…</p>
  if (payments.data.length === 0) {
    return (
      <div
        data-slot="empty-state"
        className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground"
      >
        <p>Esta cita aún no tiene pagos.</p>
      </div>
    )
  }

  const methodNameOf = (methodId: Id) => {
    if (!methods.data) return METHOD_LOADING_LABEL
    return methods.data.find((method) => method.id === methodId)?.name ?? DELETED_METHOD_LABEL
  }

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2" aria-label="Pagos de la cita">
        {payments.data.map((payment) => (
          <PaymentItem
            key={payment.id}
            payment={payment}
            methodName={methodNameOf(payment.methodId)}
            canVoid={canVoid}
            onVoid={setVoiding}
          />
        ))}
      </ul>
      <PaymentTotals payments={payments.data} />
      {voiding ? <VoidDialog payment={voiding} onClose={() => setVoiding(null)} /> : null}
    </div>
  )
}
