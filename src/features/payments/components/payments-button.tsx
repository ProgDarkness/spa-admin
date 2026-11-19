'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Id } from '@/lib/model'
import { useCan } from '@/lib/session'
import { PaymentsDialog } from './payments-dialog'

export type PaymentsButtonProps = { appointmentId: Id }

export function PaymentsButton({ appointmentId }: PaymentsButtonProps) {
  const [open, setOpen] = useState(false)
  const canRead = useCan('payments.read')
  if (!canRead) return null
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Pagos
      </Button>
      <PaymentsDialog appointmentId={appointmentId} open={open} onOpenChange={setOpen} />
    </>
  )
}
