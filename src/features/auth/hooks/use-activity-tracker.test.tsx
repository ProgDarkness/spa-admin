import { act, renderHook, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Result, SessionView } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { ACTIVITY_THROTTLE_MS, useActivityTracker } from './use-activity-tracker'

const START = '2026-11-12T09:00'

let recordedCalls: number

function advanceClock(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms))
}

function fire(type: 'pointerdown' | 'keydown' | 'wheel' | 'pointermove'): void {
  act(() => {
    window.dispatchEvent(new Event(type))
  })
}

beforeEach(() => {
  freezeDate(START)
  recordedCalls = 0
  mockIPC((cmd) => {
    if (cmd === 'record_activity') {
      recordedCalls += 1
      return { status: 'active', user: null }
    }
    return null
  })
})

describe('useActivityTracker', () => {
  it('registra la actividad con pointerdown y con keydown', async () => {
    renderHook(() => useActivityTracker(true))

    fire('pointerdown')
    await waitFor(() => expect(recordedCalls).toBe(1))
    advanceClock(ACTIVITY_THROTTLE_MS)
    fire('keydown')

    await waitFor(() => expect(recordedCalls).toBe(2))
  })

  it('activity_tracker_throttles_calls', async () => {
    renderHook(() => useActivityTracker(true))

    fire('pointerdown')
    advanceClock(ACTIVITY_THROTTLE_MS - 1)
    fire('keydown')
    fire('pointerdown')
    await waitFor(() => expect(recordedCalls).toBe(1))
    advanceClock(1)
    fire('keydown')

    await waitFor(() => expect(recordedCalls).toBe(2))
  })

  it('un retroceso del reloj no silencia la actividad', async () => {
    renderHook(() => useActivityTracker(true))
    fire('pointerdown')
    await waitFor(() => expect(recordedCalls).toBe(1))

    advanceClock(-ACTIVITY_THROTTLE_MS * 2)
    fire('keydown')

    await waitFor(() => expect(recordedCalls).toBe(2))
  })

  it.each(['wheel', 'pointermove'] as const)('%s cuenta como actividad con el mismo throttle', async (type) => {
    renderHook(() => useActivityTracker(true))

    fire(type)
    fire(type)
    await waitFor(() => expect(recordedCalls).toBe(1))
    advanceClock(ACTIVITY_THROTTLE_MS)
    fire(type)

    await waitFor(() => expect(recordedCalls).toBe(2))
  })

  it('el umbral del throttle es de 30 segundos', () => {
    expect(ACTIVITY_THROTTLE_MS).toBe(30_000)
  })

  it('activity_tracker_ignores_events_when_not_signed_in', async () => {
    renderHook(() => useActivityTracker(false))

    fire('pointerdown')
    fire('keydown')
    await act(async () => {})

    expect(recordedCalls).toBe(0)
  })

  it('deja de escuchar al deshabilitarse y al desmontar', async () => {
    const { rerender, unmount } = renderHook(({ enabled }) => useActivityTracker(enabled), {
      initialProps: { enabled: true },
    })

    rerender({ enabled: false })
    fire('pointerdown')
    rerender({ enabled: true })
    unmount()
    fire('keydown')
    await act(async () => {})

    expect(recordedCalls).toBe(0)
  })

  it('al volver a habilitarse el primer evento registra sin esperar el throttle', async () => {
    const { rerender } = renderHook(({ enabled }) => useActivityTracker(enabled), { initialProps: { enabled: true } })
    fire('pointerdown')
    await waitFor(() => expect(recordedCalls).toBe(1))

    rerender({ enabled: false })
    rerender({ enabled: true })
    fire('pointerdown')

    await waitFor(() => expect(recordedCalls).toBe(2))
  })

  it('entrega el resultado de record_activity al callback', async () => {
    const results: Result<SessionView | null>[] = []
    renderHook(() => useActivityTracker(true, (result) => results.push(result)))

    fire('pointerdown')

    await waitFor(() => expect(results).toEqual([{ status: 'ok', data: { status: 'active', user: null } }]))
  })
})
