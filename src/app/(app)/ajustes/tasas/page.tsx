'use client'

import { RateForm } from '@/features/rates/components/rate-form'
import { RatesTable } from '@/features/rates/components/rates-table'
import { useRates } from '@/features/rates/hooks'
import { useCan } from '@/lib/session'

function RatesList() {
  const { data, error, isPending } = useRates()
  if (isPending) return <p role="status">Cargando tasas…</p>
  if (error) {
    return (
      <p role="alert" data-tone="error" className="text-sm text-destructive">
        {error.message}
      </p>
    )
  }
  return <RatesTable rates={data} />
}

export default function RatesPage() {
  const canManageRates = useCan('rates.manage')

  return (
    <div className="grid gap-8">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Tasas de cambio</h1>
      {canManageRates ? (
        <section aria-labelledby="rate-form-heading" className="grid gap-3">
          <h2 id="rate-form-heading" className="font-serif text-xl font-medium">
            Registrar o corregir tasa
          </h2>
          <RateForm />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Solo lectura: no tienes permiso para modificar las tasas.</p>
      )}
      <section aria-labelledby="rate-history-heading" className="grid gap-3">
        <h2 id="rate-history-heading" className="font-serif text-xl font-medium">
          Historial
        </h2>
        <RatesList />
      </section>
    </div>
  )
}
