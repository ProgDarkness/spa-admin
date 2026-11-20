import { vi } from 'vitest'
import type { LocalDateTime } from '@/lib/model'

type FakeableTimer = 'Date' | 'setInterval' | 'clearInterval'

function freezeTimers(at: LocalDateTime, toFake: FakeableTimer[]): void {
  const [datePart = '', timePart = ''] = at.split('T')
  const [year = 0, month = 1, day = 1] = datePart.split('-').map(Number)
  const [hours = 0, minutes = 0] = timePart.split(':').map(Number)
  vi.useFakeTimers({ toFake })
  vi.setSystemTime(new Date(year, month - 1, day, hours, minutes))
}

export function freezeDate(at: LocalDateTime): void {
  freezeTimers(at, ['Date'])
}

export function freezeDateAndIntervals(at: LocalDateTime): void {
  freezeTimers(at, ['Date', 'setInterval', 'clearInterval'])
}
