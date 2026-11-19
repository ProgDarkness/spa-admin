'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ClockRollback } from '@/lib/bindings'
import { setupStatus } from '../api'

type SetupCheck = { kind: 'pending' } | { kind: 'failed' } | { kind: 'ready'; clockRollback: ClockRollback | null }

const PENDING_CHECK: SetupCheck = { kind: 'pending' }

export type SetupStatusView = {
  clockRollback: ClockRollback | null
  hasFailed: boolean
  retry: () => void
}

export function useSetupStatus(onNeedsOwner: () => void): SetupStatusView {
  const [check, setCheck] = useState<SetupCheck>(PENDING_CHECK)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let isCurrent = true
    setupStatus().then((result) => {
      if (!isCurrent) return
      if (result.status === 'error') return setCheck({ kind: 'failed' })
      if (result.data.needsOwner) onNeedsOwner()
      setCheck({ kind: 'ready', clockRollback: result.data.clockRollback })
    })
    return () => {
      isCurrent = false
    }
  }, [onNeedsOwner, attempt])

  const retry = useCallback(() => {
    setCheck(PENDING_CHECK)
    setAttempt((previous) => previous + 1)
  }, [])

  return {
    clockRollback: check.kind === 'ready' ? check.clockRollback : null,
    hasFailed: check.kind === 'failed',
    retry,
  }
}
