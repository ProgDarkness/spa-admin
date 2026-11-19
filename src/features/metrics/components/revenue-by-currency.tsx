import type { AmountsByCurrency, Currency } from '@/lib/model'
import { formatCents } from '@/lib/money'

const CURRENCIES: readonly Currency[] = ['USD', 'VES']

export type RevenueByCurrencyProps = {
  revenue: AmountsByCurrency
  collectedOnNonCompleted: AmountsByCurrency
}

function AmountList({ amounts }: { amounts: AmountsByCurrency }) {
  return (
    <dl className="grid grid-cols-2 gap-4">
      {CURRENCIES.map((currency) => (
        <div key={currency} className="grid gap-1">
          <dt className="text-sm text-muted-foreground">{currency}</dt>
          <dd data-slot="figure" className="font-serif text-3xl font-semibold tabular-nums">{formatCents(amounts[currency], currency)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RevenueByCurrency({ revenue, collectedOnNonCompleted }: RevenueByCurrencyProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby="revenue-heading" className="grid gap-3 rounded-md border border-border bg-card p-6">
        <h2 id="revenue-heading" className="font-serif text-lg font-medium">
          Ingreso del mes
        </h2>
        <AmountList amounts={revenue} />
      </section>
      <section aria-labelledby="non-completed-heading" className="grid gap-3 rounded-md border border-border bg-card p-6">
        <h2 id="non-completed-heading" className="font-serif text-lg font-medium">
          Cobros en citas no completadas
        </h2>
        <p className="text-sm text-muted-foreground">
          Pagos de citas canceladas o no asistidas; no cuentan como ingreso.
        </p>
        <AmountList amounts={collectedOnNonCompleted} />
      </section>
    </div>
  )
}
