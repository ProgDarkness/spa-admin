import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { PaymentMethod } from '@/lib/model'

type PaymentMethodTableProps = {
  paymentMethods: readonly PaymentMethod[]
  canManage: boolean
  onEdit(paymentMethod: PaymentMethod): void
  onToggleActive(paymentMethod: PaymentMethod): void
}

export function PaymentMethodTable({ paymentMethods, canManage, onEdit, onToggleActive }: PaymentMethodTableProps) {
  if (paymentMethods.length === 0) {
    return (
      <div
        data-slot="empty-state"
        className="rounded-md border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground"
      >
        <p>No hay métodos de pago para mostrar</p>
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <Table aria-label="Métodos de pago">
        <TableCaption className="sr-only">Métodos de pago</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Estado</TableHead>
            {canManage ? <TableHead>Acciones</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paymentMethods.map((paymentMethod) => (
            <TableRow key={paymentMethod.id}>
              <TableCell className="font-medium">{paymentMethod.name}</TableCell>
              <TableCell>
                <Badge variant={paymentMethod.active ? 'default' : 'secondary'}>
                  {paymentMethod.active ? 'Activo' : 'Inactivo'}
                </Badge>
              </TableCell>
              {canManage ? (
                <TableCell>
                  <div data-slot="row-actions" className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => onEdit(paymentMethod)}>
                      {`Editar ${paymentMethod.name}`}
                    </Button>
                    <Button
                      variant={paymentMethod.active ? 'destructive' : 'secondary'}
                      size="sm"
                      onClick={() => onToggleActive(paymentMethod)}
                    >
                      {`${paymentMethod.active ? 'Desactivar' : 'Reactivar'} ${paymentMethod.name}`}
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
