'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeactivateDialog } from '@/features/resources/components/deactivate-dialog'
import { ResourceForm } from '@/features/resources/components/resource-form'
import { ResourceTable } from '@/features/resources/components/resource-table'
import {
  useCreateResource,
  useResources,
  useSetResourceActive,
  useUpdateResource,
} from '@/features/resources/hooks'
import type { AppError, Resource, ResourceInput } from '@/lib/model'
import { failureOf } from '@/lib/result'
import { useCan } from '@/lib/session'

type Editor = { mode: 'create' } | { mode: 'edit'; resource: Resource }

const NEW_RESOURCE: ResourceInput = { name: '', kind: 'cabin' }

function useResourceActions(editor: Editor | null, closeEditor: () => void) {
  const create = useCreateResource()
  const update = useUpdateResource()
  const setActive = useSetResourceActive()
  const [actionFailure, setActionFailure] = useState<AppError | null>(null)

  async function submitEditor(input: ResourceInput): Promise<AppError | null> {
    if (!editor) return null
    const failure = await failureOf(() =>
      editor.mode === 'create' ? create.mutateAsync(input) : update.mutateAsync({ id: editor.resource.id, input }),
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
    reactivate: async (resource: Resource) =>
      setActionFailure(await failureOf(() => setActive.mutateAsync({ id: resource.id, active: true }))),
    deactivate: (resource: Resource) => failureOf(() => setActive.mutateAsync({ id: resource.id, active: false })),
  }
}

type EditorDialogProps = {
  editor: Editor
  onSubmit: (input: ResourceInput) => Promise<AppError | null>
  onClose: () => void
}

function EditorDialog({ editor, onSubmit, onClose }: EditorDialogProps) {
  const isCreating = editor.mode === 'create'
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreating ? 'Nuevo recurso' : `Editar ${editor.resource.name}`}</DialogTitle>
          <DialogDescription>Define el nombre y el tipo del recurso.</DialogDescription>
        </DialogHeader>
        <ResourceForm
          initialValue={isCreating ? NEW_RESOURCE : editor.resource}
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
  query: Pick<ReturnType<typeof useResources>, 'isPending' | 'error'>
  children: ReactNode
}

function ListingState({ query, children }: ListingStateProps) {
  if (query.isPending) return <p role="status">Cargando recursos…</p>
  if (query.error) return <AlertMessage message={query.error.message} />
  return <>{children}</>
}

export default function ResourcesPage() {
  const canManage = useCan('resources.manage')
  const [includeInactive, setIncludeInactive] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deactivating, setDeactivating] = useState<Resource | null>(null)
  const resources = useResources({ includeInactive })
  const closeEditor = () => setEditor(null)
  const actions = useResourceActions(editor, closeEditor)

  function openEditor(nextEditor: Editor) {
    actions.clearFailure()
    setEditor(nextEditor)
  }

  function toggleActive(resource: Resource) {
    if (resource.active) setDeactivating(resource)
    else void actions.reactivate(resource)
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Recursos</h1>
        {canManage ? <Button onClick={() => openEditor({ mode: 'create' })}>Nuevo recurso</Button> : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />
        Mostrar inactivos
      </label>
      <AlertMessage message={actions.actionFailure?.message ?? null} />
      <ListingState query={resources}>
        <ResourceTable
          resources={resources.data ?? []}
          canManage={canManage}
          onEdit={(resource) => openEditor({ mode: 'edit', resource })}
          onToggleActive={toggleActive}
        />
      </ListingState>
      {editor ? <EditorDialog editor={editor} onSubmit={actions.submitEditor} onClose={closeEditor} /> : null}
      {deactivating ? (
        <DeactivateDialog
          key={deactivating.id}
          resource={deactivating}
          onConfirm={() => actions.deactivate(deactivating)}
          onClose={() => setDeactivating(null)}
        />
      ) : null}
    </section>
  )
}
