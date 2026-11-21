import '@testing-library/jest-dom/vitest'
import { clearMocks } from '@tauri-apps/api/mocks'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { createSeed } from '@/lib/mock/seed'
import { todayLocal } from '@/lib/datetime'
import { resetNavigationMock } from '@/test/navigation'
import { installDevIpc } from '@/test/dev-ipc'

vi.mock('next/navigation', () => import('@/test/navigation'))

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => {}
Element.prototype.releasePointerCapture = () => {}
Element.prototype.scrollIntoView = () => {}
globalThis.ResizeObserver = ResizeObserverStub

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
})

beforeEach(() => {
  installDevIpc(createSeed(todayLocal()))
})

afterEach(() => {
  clearMocks()
  cleanup()
  resetNavigationMock()
  vi.useRealTimers()
})
