import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MonthlyMetrics } from '@/lib/model'

type Stat = { label: string; value: number }

function StatList({ stats }: { stats: readonly Stat[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="grid gap-1">
          <dt className="text-sm text-muted-foreground">{stat.label}</dt>
          <dd data-slot="figure" className="font-serif text-3xl font-semibold tabular-nums">{stat.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function StatCard({ title, stats }: { title: string; stats: readonly Stat[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <StatList stats={stats} />
      </CardContent>
    </Card>
  )
}

export function MetricsCards({ metrics }: { metrics: MonthlyMetrics }) {
  const { appointments } = metrics
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <StatCard
        title="Clientes"
        stats={[
          { label: 'Clientes nuevos', value: metrics.newClients },
          { label: 'Clientes recurrentes', value: metrics.recurringClients },
        ]}
      />
      <StatCard
        title="Citas del mes"
        stats={[
          { label: 'Programadas', value: appointments.scheduled },
          { label: 'En curso', value: appointments.inProgress },
          { label: 'Completadas', value: appointments.completed },
          { label: 'Canceladas', value: appointments.cancelled },
          { label: 'No asistió', value: appointments.noShow },
        ]}
      />
    </div>
  )
}
