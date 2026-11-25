'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeactivateDialog } from '@/features/payment-methods/components/deactivate-dialog'
import { PaymentMethodForm } from '@/features/payment-methods/components/payment-method-form'
import { PaymentMethodTable } from '@/features/payment-methods/components/payment-method-table'
import {
  useCreatePaymentMethod,
  usePaymentMethods,
  useSetPaymentMethodActive,
  useUpdatePaymentMethod,
} from '@/features/payment-methods/hooks'
import type { AppError, PaymentMethod, PaymentMethodInput } from '@/lib/model'
import { failureOf } from '@/lib/result'
import { useCan } from '@/lib/session'

type Editor = { mode: 'create' } | { mode: 'edit'; paymentMethod: PaymentMethod }

const NEW_PAYMENT_METHOD: PaymentMethodInput = { name: '' }

function usePaymentMethodActions(editor: Editor | null, closeEditor: () => void) {
  const create = useCreatePaymentMethod()
  const update = useUpdatePaymentMethod()
  const setActive = useSetPaymentMethodActive()
  const [actionFailure, setActionFailure] = useState<AppError | null>(null)

  async function submitEditor(input: PaymentMethodInput): Promise<AppError | null> {
    if (!editor) return null
    const failure = await failureOf(() =>
      editor.mode === 'create'
        ? create.mutateAsync(input)
        : update.mutateAsync({ id: editor.paymentMethod.id, input }),
    )
    if (!failure) {
      setActionFailure(null)
      closeEditor()
    }
    return failure
  }

  return {
    actionFailure,
    clearFailure: () => setActionFailure(null),
    submitEditor,
    reactivate: async (paymentMethod: PaymentMethod) =>
      setActionFailure(await failureOf(() => setActive.mutateAsync({ id: paymentMethod.id, active: true }))),
    deactivate: (paymentMethod: PaymentMethod) =>
      failureOf(() => setActive.mutateAsync({ id: paymentMethod.id, active: false })),
  }
}

type EditorDialogProps = {
  editor: Editor
  onSubmit: (input: PaymentMethodInput) => Promise<AppError | null>
  onClose: () => void
}

function EditorDialog({ editor, onSubmit, onClose }: EditorDialogProps) {
  const isCreating = editor.mode === 'create'
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreating ? 'Nuevo método de pago' : `Editar ${editor.paymentMethod.name}`}</DialogTitle>
          <DialogDescription>Define el nombre del método de pago.</DialogDescription>
        </DialogHeader>
        <PaymentMethodForm
          initialValue={isCreating ? NEW_PAYMENT_METHOD : editor.paymentMethod}
          submitLabel={isCreating ? 'Crear' : 'Guardar'}
          onSubmit={onSubmit}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}

function AlertMessage({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" data-tone="error" className="text-sm text-destructive">
      {message}
    </p>
  )
}

type ListingStateProps = {
  query: Pick<ReturnType<typeof usePaymentMethods>, 'isPending' | 'error'>
  children: ReactNode
}

function ListingState({ query, children }: ListingStateProps) {
  if (query.isPending) return <p role="status">Cargando métodos de pago…</p>
  if (query.error) return <AlertMessage message={query.error.message} />
  return <>{children}</>
}

export default function PaymentMethodsPage() {
  const canManage = useCan('catalog.write')
  const [includeInactive, setIncludeInactive] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deactivating, setDeactivating] = useState<PaymentMethod | null>(null)
  const paymentMethods = usePaymentMethods()
  const closeEditor = () => setEditor(null)
  const actions = usePaymentMethodActions(editor, closeEditor)
  const visibleMethods = (paymentMethods.data ?? []).filter((method) => includeInactive || method.active)

  function openEditor(nextEditor: Editor) {
    actions.clearFailure()
    setEditor(nextEditor)
  }

  function toggleActive(paymentMethod: PaymentMethod) {
    if (paymentMethod.active) setDeactivating(paymentMethod)
    else void actions.reactivate(paymentMethod)
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Métodos de pago</h1>
        {canManage ? <Button onClick={() => openEditor({ mode: 'create' })}>Nuevo método de pago</Button> : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />
        Mostrar inactivos
      </label>
      <AlertMessage message={actions.actionFailure?.message ?? null} />
      <ListingState query={paymentMethods}>
        <PaymentMethodTable
          paymentMethods={visibleMethods}
          canManage={canManage}
          onEdit={(paymentMethod) => openEditor({ mode: 'edit', paymentMethod })}
          onToggleActive={toggleActive}
        />
      </ListingState>
      {editor ? <EditorDialog editor={editor} onSubmit={actions.submitEditor} onClose={closeEditor} /> : null}
      {deactivating ? (
        <DeactivateDialog
          key={deactivating.id}
          paymentMethod={deactivating}
          onConfirm={() => actions.deactivate(deactivating)}
          onClose={() => setDeactivating(null)}
        />
      ) : null}
    </section>
  )
}
