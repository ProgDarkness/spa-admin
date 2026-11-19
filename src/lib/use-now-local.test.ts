import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNowLocal } from './use-now-local'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(2026, 10, 12, 9, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNowLocal', () => {
  it('devuelve la hora local actual al montar', () => {
    const { result } = renderHook(() => useNowLocal())

    expect(result.current).toBe('2026-11-12T09:00')
  })

  it('se actualiza cada 30 segundos y no antes', () => {
    const { result } = renderHook(() => useNowLocal())

    act(() => {
      vi.setSystemTime(new Date(2026, 10, 12, 9, 1, 0))
      vi.advanceTimersByTime(29_999)
    })
    expect(result.current).toBe('2026-11-12T09:00')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('2026-11-12T09:01')
  })

  it('limpia el intervalo al desmontar', () => {
    const { unmount } = renderHook(() => useNowLocal())
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
