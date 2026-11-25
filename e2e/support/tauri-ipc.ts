import type { Page } from '@playwright/test'
import { createSeed } from '../../src/lib/mock/seed'
import type { Id, SessionUser } from '../../src/lib/model'
import { createAuthIpcBackend } from '../../src/test/ipc/auth-backend'
import { createDevBackends } from '../../src/test/ipc/dev-backends'

const SEED_REFERENCE_DATE = '2026-11-12'
const BRIDGE_NAME = '__spaInvoke'
const PAGE_LOAD_COMMAND = '__pageLoad'

export type IpcOverride = (args: unknown) => unknown

export type TauriIpcOptions = {
  withoutUsers?: boolean
  recoverableUsernames?: readonly string[]
  overrides?: Readonly<Record<string, IpcOverride>>
}

export type TauriIpcHandle = { advanceClock(ms: number): Promise<void>; waitForReply(cmd: string): Promise<void> }

type BridgeReply = { ok: true; value: unknown } | { ok: false; isError: boolean; payload: unknown }
type Bridge = (cmd: string, args: unknown, browserNowMs: number) => Promise<BridgeReply>

function replyFrom(caught: unknown): BridgeReply {
  if (caught instanceof Error) return { ok: false, isError: true, payload: caught.message }
  return { ok: false, isError: false, payload: caught }
}

export async function installTauriIpc(page: Page, options: TauriIpcOptions = {}): Promise<TauriIpcHandle> {
  let users: readonly SessionUser[] = options.withoutUsers ? [] : createSeed(SEED_REFERENCE_DATE).users
  let sessionUserId: Id | null = null
  let nowMs = 0
  const authBackend = createAuthIpcBackend(
    () => users,
    {
      read: () => sessionUserId,
      write: (id) => {
        sessionUserId = id
      },
    },
    {
      now: () => nowMs,
      directory: {
        add: (user) => {
          users = [...users, user]
        },
      },
      ...(options.recoverableUsernames ? { recoverableUsernames: options.recoverableUsernames } : {}),
    },
  )

  const buildBackend = () =>
    createDevBackends({
      auth: authBackend,
      session: () => users.find((user) => user.id === sessionUserId) ?? null,
      seed: createSeed(SEED_REFERENCE_DATE),
      now: () => (nowMs === 0 ? Date.now() : nowMs),
    })
  let backend = buildBackend()

  const overrides = options.overrides ?? {}
  const repliedCommands = new Set<string>()
  let replyWaiters: readonly { cmd: string; resolve: () => void }[] = []

  function noteReply(cmd: string): void {
    repliedCommands.add(cmd)
    replyWaiters.filter((waiter) => waiter.cmd === cmd).forEach((waiter) => waiter.resolve())
    replyWaiters = replyWaiters.filter((waiter) => waiter.cmd !== cmd)
  }

  function resetForPageLoad(): void {
    sessionUserId = null
    backend = buildBackend()
  }

  async function dispatch(cmd: string, args: unknown): Promise<BridgeReply> {
    if (cmd === PAGE_LOAD_COMMAND) {
      resetForPageLoad()
      return { ok: true, value: null }
    }
    try {
      const override = Object.hasOwn(overrides, cmd) ? overrides[cmd] : undefined
      const value = override ? await override(args) : backend(cmd, args)
      return { ok: true, value: value ?? null }
    } catch (caught) {
      return replyFrom(caught)
    }
  }

  await page.exposeFunction(BRIDGE_NAME, async (cmd: string, args: unknown, browserNowMs: number) => {
    nowMs = browserNowMs
    const reply = await dispatch(cmd, args)
    noteReply(cmd)
    return reply
  })

  await page.addInitScript(([bridgeName, pageLoadCommand]: readonly [string, string]) => {
    const bridge = (window as unknown as Record<string, Bridge>)[bridgeName] as Bridge
    const callbacks = new Map<number, (data: unknown) => unknown>()
    let nextCallbackId = 1
    void bridge(pageLoadCommand, undefined, Date.now())
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: unknown) => {
        const reply = await bridge(cmd, args, Date.now())
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
  }, [BRIDGE_NAME, PAGE_LOAD_COMMAND] as const)

  return {
    advanceClock: (ms) => page.clock.fastForward(ms),
    waitForReply: (cmd) =>
      repliedCommands.has(cmd)
        ? Promise.resolve()
        : new Promise((resolve) => {
            replyWaiters = [...replyWaiters, { cmd, resolve }]
          }),
  }
}
