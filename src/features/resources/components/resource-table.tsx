import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Resource } from '@/lib/model'
import { RESOURCE_KIND_LABELS } from '../schemas'

type ResourceTableProps = {
  resources: readonly Resource[]
  canManage: boolean
  onEdit(resource: Resource): void
  onToggleActive(resource: Resource): void
}

export function ResourceTable({ resources, canManage, onEdit, onToggleActive }: ResourceTableProps) {
  if (resources.length === 0) {
    return (
      <div
        data-slot="empty-state"
        className="rounded-md border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground"
      >
        <p>No hay recursos para mostrar</p>
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <Table aria-label="Recursos agendables">
        <TableCaption className="sr-only">Recursos agendables</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Estado</TableHead>
            {canManage ? <TableHead>Acciones</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {resources.map((resource) => (
            <TableRow key={resource.id}>
              <TableCell className="font-medium">{resource.name}</TableCell>
              <TableCell>{RESOURCE_KIND_LABELS[resource.kind]}</TableCell>
              <TableCell>
                <Badge variant={resource.active ? 'default' : 'secondary'}>
                  {resource.active ? 'Activo' : 'Inactivo'}
                </Badge>
              </TableCell>
              {canManage ? (
                <TableCell>
                  <div data-slot="row-actions" className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => onEdit(resource)}>
                      {`Editar ${resource.name}`}
                    </Button>
                    <Button
                      variant={resource.active ? 'destructive' : 'secondary'}
                      size="sm"
                      onClick={() => onToggleActive(resource)}
                    >
                      {`${resource.active ? 'Desactivar' : 'Reactivar'} ${resource.name}`}
                    </Button>
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
