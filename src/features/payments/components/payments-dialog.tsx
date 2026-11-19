'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Id } from '@/lib/model'
import { useCan } from '@/lib/session'
import { PaymentForm } from './payment-form'
import { PaymentList } from './payment-list'

export type PaymentsDialogProps = {
  appointmentId: Id
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PaymentsDialog({ appointmentId, open, onOpenChange }: PaymentsDialogProps) {
  const canWrite = useCan('payments.write')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pagos de la cita</DialogTitle>
          <DialogDescription>Se admiten varios pagos por cita, en dólares o bolívares, en cualquier estado.</DialogDescription>
        </DialogHeader>
        <PaymentList appointmentId={appointmentId} />
        {canWrite ? <PaymentForm appointmentId={appointmentId} /> : null}
      </DialogContent>
    </Dialog>
  )
}
