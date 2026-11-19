import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { YearMonth } from '@/lib/model'

const MONTHS_PER_YEAR = 12
const YEAR_LENGTH = 4

export type MonthPickerProps = { month: YearMonth; onChange: (month: YearMonth) => void }

function shiftMonth(month: YearMonth, delta: number): YearMonth {
  const year = Number(month.slice(0, YEAR_LENGTH))
  const monthIndex = Number(month.slice(YEAR_LENGTH + 1)) - 1
  const absolute = year * MONTHS_PER_YEAR + monthIndex + delta
  const shiftedYear = Math.floor(absolute / MONTHS_PER_YEAR)
  const shiftedMonth = (absolute % MONTHS_PER_YEAR) + 1
  return `${String(shiftedYear).padStart(YEAR_LENGTH, '0')}-${String(shiftedMonth).padStart(2, '0')}`
}

export function MonthPicker({ month, onChange }: MonthPickerProps) {
  return (
    <div className="flex items-end gap-2">
      <Button type="button" variant="outline" size="icon" aria-label="Mes anterior" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <div className="grid gap-1">
        <Label htmlFor="metrics-month">Mes</Label>
        <Input
          id="metrics-month"
          type="month"
          value={month}
          onChange={(event) => {
            if (event.target.value !== '') onChange(event.target.value)
          }}
        />
      </div>
      <Button type="button" variant="outline" size="icon" aria-label="Mes siguiente" onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )
}
