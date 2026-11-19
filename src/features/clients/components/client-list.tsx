'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Client } from '@/lib/model'
import { appErrorOf } from '@/lib/result'
import { clientRecordHref } from '@/lib/routes'
import { useClients, useReactivateClient, useSoftDeleteClient } from '../hooks'

export type ClientListProps = {
  canWrite: boolean
  onEditAction: (client: Client) => void
}

type RunAction = (action: () => Promise<unknown>) => Promise<void>

const ACTION_FAILED_MESSAGE = 'No se pudo completar la acción'
const LOAD_FAILED_MESSAGE = 'No se pudieron cargar los clientes'

function fullNameOf(client: Client): string {
  return `${client.firstName} ${client.lastName}`
}

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" data-tone="error" className="text-sm text-destructive">
      {message}
    </p>
  )
}

type DeleteClientDialogProps = {
  client: Client
  onConfirm: () => void
  onClose: () => void
}

function DeleteClientDialog({ client, onConfirm, onClose }: DeleteClientDialogProps) {
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`¿Eliminar a ${fullNameOf(client)}?`}</DialogTitle>
          <DialogDescription>Podrás reactivarlo.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ClientActionsProps = {
  client: Client
  runAction: RunAction
  onEditAction: (client: Client) => void
  onDeleteRequested: (client: Client) => void
}

function ClientActions({ client, runAction, onEditAction, onDeleteRequested }: ClientActionsProps) {
  const reactivate = useReactivateClient()
  const name = fullNameOf(client)
  if (client.deletedAt !== null) {
    return (
      <div data-slot="row-actions" className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Reactivar ${name}`}
          onClick={() => runAction(() => reactivate.mutateAsync(client.id))}
        >
          Reactivar
        </Button>
      </div>
    )
  }
  return (
    <div data-slot="row-actions" className="flex gap-2">
      <Button variant="outline" size="sm" aria-label={`Editar ${name}`} onClick={() => onEditAction(client)}>
        Editar
      </Button>
      <Button variant="destructive" size="sm" aria-label={`Eliminar ${name}`} onClick={() => onDeleteRequested(client)}>
        Eliminar
      </Button>
    </div>
  )
}

type ClientTableProps = Omit<ClientActionsProps, 'client'> & {
  rows: readonly Client[]
  canWrite: boolean
}

function ClientTable({ rows, canWrite, ...actionProps }: ClientTableProps) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Cédula</TableHead>
            <TableHead>Teléfono</TableHead>
            {canWrite ? <TableHead>Acciones</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((client) => (
            <TableRow key={client.id}>
              <TableCell>
                <Link href={clientRecordHref(client.id)} className="font-medium underline-offset-4 hover:underline">
                  {fullNameOf(client)}
                </Link>
                {client.deletedAt !== null ? (
                  <Badge variant="secondary" className="ml-2">
                    Eliminado
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>{client.nationalId}</TableCell>
              <TableCell>{client.phone}</TableCell>
              {canWrite ? (
                <TableCell>
                  <ClientActions client={client} {...actionProps} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type ClientFiltersProps = {
  query: string
  includeDeleted: boolean
  onQueryChange: (query: string) => void
  onIncludeDeletedChange: (includeDeleted: boolean) => void
}

function ClientFilters({ query, includeDeleted, onQueryChange, onIncludeDeletedChange }: ClientFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Input
        type="search"
        aria-label="Buscar clientes"
        placeholder="Buscar por nombre, cédula o teléfono"
        className="max-w-sm"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={includeDeleted}
          onChange={(event) => onIncludeDeletedChange(event.target.checked)}
        />
        Mostrar eliminados
      </label>
    </div>
  )
}

export function ClientList({ canWrite, onEditAction }: ClientListProps) {
  const [query, setQuery] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [deleting, setDeleting] = useState<Client | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)
  const clients = useClients({ query, includeDeleted })
  const softDelete = useSoftDeleteClient()
  const rows = clients.data ?? []

  const runAction: RunAction = async (action) => {
    setActionErrorMessage(null)
    try {
      await action()
    } catch (caught) {
      setActionErrorMessage(appErrorOf(caught)?.message ?? ACTION_FAILED_MESSAGE)
    }
  }

  function confirmDeletion(client: Client) {
    setDeleting(null)
    void runAction(() => softDelete.mutateAsync(client.id))
  }

  return (
    <section className="grid gap-4">
      <ClientFilters
        query={query}
        includeDeleted={includeDeleted}
        onQueryChange={setQuery}
        onIncludeDeletedChange={setIncludeDeleted}
      />
      <ErrorMessage message={actionErrorMessage} />
      <ErrorMessage message={clients.isError ? (appErrorOf(clients.error)?.message ?? LOAD_FAILED_MESSAGE) : null} />
      {clients.isSuccess && rows.length === 0 ? (
        <div
          data-slot="empty-state"
          className="rounded-md border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground"
        >
          <p>No se encontraron clientes</p>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ClientTable
          rows={rows}
          canWrite={canWrite}
          runAction={runAction}
          onEditAction={onEditAction}
          onDeleteRequested={setDeleting}
        />
      ) : null}
      {deleting ? (
        <DeleteClientDialog
          client={deleting}
          onConfirm={() => confirmDeletion(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  )
}
