import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Service } from '@/lib/model'
import { formatCents } from '@/lib/money'

export type ServiceTableProps = {
  services: readonly Service[]
  canWrite: boolean
  onEdit(service: Service): void
  onToggleActive(service: Service): void
}

type RowProps = Omit<ServiceTableProps, 'services'> & { service: Service }

function ServiceRow({ service, canWrite, onEdit, onToggleActive }: RowProps) {
  const toggleLabel = service.active ? 'Desactivar' : 'Reactivar'
  return (
    <TableRow>
      <TableCell className="font-medium">{service.name}</TableCell>
      <TableCell className="tabular-nums">{formatCents(service.priceCents, service.currency)}</TableCell>
      <TableCell className="tabular-nums">{`${service.durationMin} min`}</TableCell>
      <TableCell>
        <Badge variant={service.active ? 'default' : 'secondary'}>{service.active ? 'Activo' : 'Inactivo'}</Badge>
      </TableCell>
      {canWrite ? (
        <TableCell>
          <div data-slot="row-actions" className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onEdit(service)} aria-label={`Editar ${service.name}`}>
              Editar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleActive(service)}
              aria-label={`${toggleLabel} ${service.name}`}
            >
              {toggleLabel}
            </Button>
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  )
}

export function ServiceTable({ services, canWrite, onEdit, onToggleActive }: ServiceTableProps) {
  if (services.length === 0)
    return (
      <div
        data-slot="empty-state"
        className="rounded-md border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground"
      >
        <p>No hay servicios registrados</p>
      </div>
    )
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Servicio</TableHead>
            <TableHead>Precio</TableHead>
            <TableHead>Duración</TableHead>
            <TableHead>Estado</TableHead>
            {canWrite ? <TableHead>Acciones</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              canWrite={canWrite}
              onEdit={onEdit}
              onToggleActive={onToggleActive}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
