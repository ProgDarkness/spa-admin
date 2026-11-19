import { useEffect, useState } from 'react'
import { nowLocal } from './datetime'
import type { LocalDateTime } from './model'

const REFRESH_INTERVAL_MS = 30_000

export function useNowLocal(): LocalDateTime {
  const [now, setNow] = useState<LocalDateTime>(nowLocal)

  useEffect(() => {
    const timer = setInterval(() => setNow(nowLocal()), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return now
}
