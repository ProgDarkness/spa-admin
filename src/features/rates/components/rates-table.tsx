import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ExchangeRate } from '@/lib/model'
import { formatRateE4 } from '@/lib/money'

export function RatesTable({ rates }: { rates: readonly ExchangeRate[] }) {
  if (rates.length === 0) {
    return (
      <div
        data-slot="empty-state"
        className="rounded-md border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground"
      >
        <p>Aún no hay tasas registradas.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <Table aria-label="Tasas de cambio">
        <TableCaption className="sr-only">
          Tasas de cambio registradas, de la más reciente a la más antigua
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Fecha</TableHead>
            <TableHead scope="col" className="text-right">
              Bs por USD
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rates.map((rate) => (
            <TableRow key={rate.date}>
              <TableCell>
                <time dateTime={rate.date}>{rate.date}</time>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatRateE4(rate.rateBsPerUsdE4)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
