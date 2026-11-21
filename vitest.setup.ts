import '@testing-library/jest-dom/vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { currentUser } from '@/lib/mock/authorize'
import { createSeed } from '@/lib/mock/seed'
import { commit, getState } from '@/lib/mock/store'
import { todayLocal } from '@/lib/datetime'
import { resetNavigationMock } from '@/test/navigation'
import { createAuthIpcBackend } from '@/test/ipc/auth-backend'
import { createDevBackends } from '@/test/ipc/dev-backends'

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
  const authBackend = createAuthIpcBackend(() => getState().users, {
    read: () => getState().sessionUserId,
    write: (id) => commit({ ...getState(), sessionUserId: id }),
  })
  mockIPC(
    createDevBackends({
      auth: authBackend,
      session: () => currentUser(getState()),
      seed: createSeed(todayLocal()),
    }),
  )
})

afterEach(() => {
  clearMocks()
  cleanup()
  resetNavigationMock()
  vi.useRealTimers()
})
