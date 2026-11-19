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
import type { AppError, Id, Resource } from '@/lib/model'
import { useFutureAppointmentsOfResource } from '../hooks'

type DeactivateDialogProps = {
  resource: Resource
  onConfirm(): Promise<AppError | null>
  onClose(): void
}

function formatLocalDateTime(value: string): string {
  return value.replace('T', ' ')
}

function BlockingAppointments({ resource, entityIds }: { resource: Resource; entityIds: readonly Id[] }) {
  const query = useFutureAppointmentsOfResource(resource.id)
  const blocking = (query.data ?? []).filter((appointment) => entityIds.includes(appointment.id))
  if (blocking.length === 0) return null
  return (
    <div>
      <p className="text-sm font-medium">Citas a reubicar antes de desactivar:</p>
      <ul className="list-disc pl-5 text-sm">
        {blocking.map((appointment) => (
          <li key={appointment.id}>
            {`Cita #${appointment.id} · ${formatLocalDateTime(appointment.startsAt)} · ${resource.name}`}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function DeactivateDialog({ resource, onConfirm, onClose }: DeactivateDialogProps) {
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
          <DialogTitle>{`Desactivar ${resource.name}`}</DialogTitle>
          <DialogDescription>
            El recurso dejará de aparecer para agendar nuevas citas. Podrás reactivarlo cuando quieras.
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <p role="alert" data-tone="error" className="text-sm text-destructive">
            {failure.message}
          </p>
        ) : null}
        {failure?.code === 'resourceHasFutureAppointments' && failure.entityIds ? (
          <BlockingAppointments resource={resource} entityIds={failure.entityIds} />
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
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
