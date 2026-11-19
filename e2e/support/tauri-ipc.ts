import type { Page } from '@playwright/test'
import { createSeed } from '../../src/lib/mock/seed'
import type { Id } from '../../src/lib/model'
import { createAuthIpcBackend } from '../../src/test/ipc/auth-backend'

const SEED_REFERENCE_DATE = '2026-11-12'
const BRIDGE_NAME = '__spaInvoke'

type BridgeReply = { ok: true; value: unknown } | { ok: false; isError: boolean; payload: unknown }
type Bridge = (cmd: string, args: unknown) => Promise<BridgeReply>

function replyFrom(caught: unknown): BridgeReply {
  if (caught instanceof Error) return { ok: false, isError: true, payload: caught.message }
  return { ok: false, isError: false, payload: caught }
}

export async function installTauriIpc(page: Page): Promise<void> {
  const users = createSeed(SEED_REFERENCE_DATE).users
  let sessionUserId: Id | null = null
  const backend = createAuthIpcBackend(() => users, {
    read: () => sessionUserId,
    write: (id) => {
      sessionUserId = id
    },
  })

  await page.exposeFunction(BRIDGE_NAME, (cmd: string, args: unknown): BridgeReply => {
    try {
      return { ok: true, value: backend(cmd, args) ?? null }
    } catch (caught) {
      return replyFrom(caught)
    }
  })

  await page.addInitScript((bridgeName: string) => {
    const bridge = (window as unknown as Record<string, Bridge>)[bridgeName] as Bridge
    const callbacks = new Map<number, (data: unknown) => unknown>()
    let nextCallbackId = 1
    void bridge('logout', undefined)
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: unknown) => {
        const reply = await bridge(cmd, args)
        if (reply.ok) return reply.value
        throw reply.isError ? new Error(String(reply.payload)) : reply.payload
      },
      transformCallback: (callback: (data: unknown) => unknown) => {
        const id = nextCallbackId++
        callbacks.set(id, callback)
        return id
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    }
  }, BRIDGE_NAME)
}
