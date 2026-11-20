import { act, renderHook, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { describe, expect, it, vi } from 'vitest'
import type { ClockRollback } from '@/lib/bindings'
import { useSetupStatus } from './use-setup-status'

const ROLLBACK: ClockRollback = { lastRecordedAt: '2026-11-12T10:00:00', detectedAt: '2026-11-10T08:00:00' }

function answerSetupStatus(response: () => unknown): void {
  mockIPC((cmd) => {
    if (cmd !== 'setup_status') return null
    return response()
  })
}

describe('useSetupStatus', () => {
  it('expone el retroceso de reloj cuando setup_status responde', async () => {
    answerSetupStatus(() => ({ needsOwner: false, clockRollback: ROLLBACK }))

    const { result } = renderHook(() => useSetupStatus(vi.fn()))

    await waitFor(() => expect(result.current.clockRollback).toEqual(ROLLBACK))
    expect(result.current.hasFailed).toBe(false)
  })

  it('avisa a onNeedsOwner cuando no hay propietaria', async () => {
    answerSetupStatus(() => ({ needsOwner: true, clockRollback: null }))
    const onNeedsOwner = vi.fn()

    renderHook(() => useSetupStatus(onNeedsOwner))

    await waitFor(() => expect(onNeedsOwner).toHaveBeenCalledTimes(1))
  })

  it('marca hasFailed ante un error y retry vuelve a consultar', async () => {
    let isFailing = true
    answerSetupStatus(() => {
      if (isFailing) throw new Error('IPC caído')
      return { needsOwner: false, clockRollback: ROLLBACK }
    })
    const { result } = renderHook(() => useSetupStatus(vi.fn()))
    await waitFor(() => expect(result.current.hasFailed).toBe(true))
    isFailing = false

    act(() => result.current.retry())

    await waitFor(() => expect(result.current.clockRollback).toEqual(ROLLBACK))
    expect(result.current.hasFailed).toBe(false)
  })

  it('descarta la respuesta si se desmonta antes de recibirla', async () => {
    const onNeedsOwner = vi.fn()
    answerSetupStatus(() => ({ needsOwner: true, clockRollback: null }))

    const { unmount } = renderHook(() => useSetupStatus(onNeedsOwner))
    unmount()
    await act(async () => {})

    expect(onNeedsOwner).not.toHaveBeenCalled()
  })
})
