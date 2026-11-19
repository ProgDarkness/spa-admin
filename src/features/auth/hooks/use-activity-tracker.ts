'use client'

import { useEffect, useRef } from 'react'
import type { Result, SessionView } from '@/lib/model'
import { recordActivity } from '../api'

export const ACTIVITY_THROTTLE_MS = 30_000

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'pointermove'] as const

function isWithinThrottle(elapsedMs: number): boolean {
  return elapsedMs >= 0 && elapsedMs < ACTIVITY_THROTTLE_MS
}

export function useActivityTracker(enabled: boolean, onResult?: (result: Result<SessionView | null>) => void): void {
  const onResultRef = useRef(onResult)

  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  useEffect(() => {
    if (!enabled) return
    let lastRecordedAt: number | null = null

    function handleActivity(): void {
      const now = Date.now()
      if (lastRecordedAt !== null && isWithinThrottle(now - lastRecordedAt)) return
      lastRecordedAt = now
      void recordActivity().then((result) => onResultRef.current?.(result))
    }

    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, handleActivity)
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, handleActivity)
    }
  }, [enabled])
}
