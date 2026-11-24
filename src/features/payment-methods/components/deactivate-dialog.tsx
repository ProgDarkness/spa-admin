'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AppError, PaymentMethod } from '@/lib/model'

type DeactivateDialogProps = {
  paymentMethod: PaymentMethod
  onConfirm(): Promise<AppError | null>
  onClose(): void
}

export function DeactivateDialog({ paymentMethod, onConfirm, onClose }: DeactivateDialogProps) {
  const [failure, setFailure] = useState<AppError | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  async function confirm() {
    setIsConfirming(true)
    const result = await onConfirm()
    setIsConfirming(false)
    setFailure(result)
    if (!result) onClose()
  }

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Desactivar ${paymentMethod.name}`}</DialogTitle>
          <DialogDescription>
            El método dejará de ofrecerse al registrar pagos nuevos. Los pagos existentes se conservan y podrás
            reactivarlo cuando quieras.
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <p role="alert" data-tone="error" className="text-sm text-destructive">
            {failure.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isConfirming}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={isConfirming}>
            Desactivar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
