'use client'

import { useState } from 'react'
import { MetricsCards } from '@/features/metrics/components/metrics-cards'
import { MonthPicker } from '@/features/metrics/components/month-picker'
import { RevenueByCurrency } from '@/features/metrics/components/revenue-by-currency'
import { useMonthlyMetrics } from '@/features/metrics/hooks'
import { monthOf, todayLocal } from '@/lib/datetime'
import type { YearMonth } from '@/lib/model'
import { useCan } from '@/lib/session'

function MetricsReport({ month }: { month: YearMonth }) {
  const { data, error, isPending } = useMonthlyMetrics(month)
  if (isPending) return <p role="status">Cargando métricas…</p>
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    )
  }
  return (
    <div className="grid gap-6">
      <MetricsCards metrics={data} />
      <RevenueByCurrency
        revenue={data.revenueByCurrency}
        collectedOnNonCompleted={data.collectedOnNonCompletedByCurrency}
        pending={data.pendingByCurrency}
      />
    </div>
  )
}

export default function MetricsPage() {
  const canReadMetrics = useCan('metrics.read')
  const [month, setMonth] = useState<YearMonth>(() => monthOf(todayLocal()))

  return (
    <div className="grid gap-6">
      <h1 className="font-serif text-2xl font-semibold">Métricas</h1>
      {canReadMetrics ? (
        <>
          <MonthPicker month={month} onChange={setMonth} />
          <MetricsReport month={month} />
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          No tienes permiso para ver las métricas
        </p>
      )}
    </div>
  )
}
