'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ServiceForm } from '@/features/catalog/components/service-form'
import { ServiceTable } from '@/features/catalog/components/service-table'
import { useServices, useSetServiceActive } from '@/features/catalog/hooks'
import { usePaymentMethods } from '@/features/payment-methods/hooks'
import type { Service } from '@/lib/model'
import { appErrorOf } from '@/lib/result'
import { useCan } from '@/lib/session'

type FormTarget = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; service: Service }

const CLOSED: FormTarget = { kind: 'closed' }
const TOGGLE_ERROR_MESSAGE = 'No se pudo cambiar el estado del servicio'

function PaymentMethodsSection() {
  const { data: methods = [] } = usePaymentMethods()
  return (
    <section aria-labelledby="payment-methods-heading" className="grid gap-2">
      <h2 id="payment-methods-heading" className="font-serif text-xl font-semibold">
        Métodos de pago
      </h2>
      <ul className="list-disc pl-6 text-sm">
        {methods.map((method) => (
          <li key={method.id}>{method.name}</li>
        ))}
      </ul>
    </section>
  )
}

function formTargetService(target: FormTarget): Service | null {
  return target.kind === 'edit' ? target.service : null
}

function useServiceToggle() {
  const [toggleErrorMessage, setToggleErrorMessage] = useState<string | null>(null)
  const setActive = useSetServiceActive()

  async function toggleActive(service: Service) {
    setToggleErrorMessage(null)
    try {
      await setActive.mutateAsync({ id: service.id, active: !service.active })
    } catch (caught) {
      setToggleErrorMessage(appErrorOf(caught)?.message ?? TOGGLE_ERROR_MESSAGE)
    }
  }

  return { toggleErrorMessage, toggleActive }
}

export default function CatalogPage() {
  const canWrite = useCan('catalog.write')
  const [target, setTarget] = useState<FormTarget>(CLOSED)
  const { data: services = [] } = useServices({ includeInactive: canWrite })
  const { toggleErrorMessage, toggleActive } = useServiceToggle()

  const editing = formTargetService(target)

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Catálogo</h1>
        {canWrite ? <Button onClick={() => setTarget({ kind: 'create' })}>Nuevo servicio</Button> : null}
      </div>
      {toggleErrorMessage ? (
        <p role="alert" data-tone="error" className="text-sm text-destructive">
          {toggleErrorMessage}
        </p>
      ) : null}
      <ServiceTable
        services={services}
        canWrite={canWrite}
        onEdit={(service) => setTarget({ kind: 'edit', service })}
        onToggleActive={toggleActive}
      />
      <PaymentMethodsSection />
      <Dialog open={target.kind !== 'closed'} onOpenChange={(isOpen) => (isOpen ? undefined : setTarget(CLOSED))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
            <DialogDescription>Precio en dólares y duración en múltiplos de 5 minutos.</DialogDescription>
          </DialogHeader>
          <ServiceForm
            key={editing?.id ?? 'new'}
            service={editing}
            onSaved={() => setTarget(CLOSED)}
            onCancel={() => setTarget(CLOSED)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
