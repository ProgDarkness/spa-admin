'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ClientForm } from '@/features/clients/components/client-form'
import { ClientList } from '@/features/clients/components/client-list'
import type { Client } from '@/lib/model'
import { useCan } from '@/lib/session'

type FormTarget = { mode: 'create' } | { mode: 'edit'; client: Client }

export default function ClientsPage() {
  const canWrite = useCan('clients.write')
  const [target, setTarget] = useState<FormTarget | null>(null)
  const closeForm = () => setTarget(null)
  const isEditing = target?.mode === 'edit'

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Clientes</h1>
        {canWrite ? <Button onClick={() => setTarget({ mode: 'create' })}>Nuevo cliente</Button> : null}
      </div>
      <ClientList canWrite={canWrite} onEditAction={(client) => setTarget({ mode: 'edit', client })} />
      <Dialog open={canWrite && target !== null} onOpenChange={(isOpen) => (isOpen ? undefined : closeForm())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
            <DialogDescription>Cédula y teléfono son obligatorios.</DialogDescription>
          </DialogHeader>
          {target ? (
            <ClientForm client={target.mode === 'edit' ? target.client : undefined} onSaved={closeForm} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
