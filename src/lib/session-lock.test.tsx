import { useMutation, useQuery } from '@tanstack/react-query'
import { act, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { Result, SessionUser } from '@/lib/model'
import { err, unwrap } from '@/lib/result'
import { freezeDateAndIntervals } from '@/test/clock'
import { createAuthIpcBackend, DEV_PASSWORD, IDLE_LOCK_MS } from '@/test/ipc/auth-backend'
import { routerMock } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import { RequireSession, SESSION_POLL_INTERVAL_MS, useSession } from './session'

const BASE_NOW_MS = Date.UTC(2026, 10, 12, 13, 0, 0)
const MINUTE_MS = 60_000

let nowMs: number
let calls: string[]

function useClockedBackend(): void {
  const backend = createAuthIpcBackend(
    () => getState().users,
    { read: () => getState().sessionUserId, write: (id) => commit({ ...getState(), sessionUserId: id }) },
    { now: () => nowMs },
  )
  mockIPC((cmd, args) => {
    calls.push(cmd)
    return backend(cmd, args)
  })
}

async function flushMacrotask(): Promise<void> {
  await act(async () => {
    await new Promise((settle) => setTimeout(settle, 0))
  })
}

const CONDITION_TIMEOUT_MS = 2_000

async function awaitCondition(condition: () => boolean, description: string): Promise<void> {
  const deadline = performance.now() + CONDITION_TIMEOUT_MS
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Condición no cumplida: ${description}`)
    await flushMacrotask()
  }
}

async function advancePollInterval(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS)
  })
  await flushMacrotask()
}

let listenerSpy: { mock: { calls: unknown[][] } }

async function findSignedInWithPollingArmed(text: string): Promise<void> {
  await screen.findByText(text)
  await awaitCondition(() => vi.getTimerCount() > 0, 'sondeo armado')
}

async function fireActivity(type: 'pointerdown' | 'keydown'): Promise<void> {
  await awaitCondition(
    () => listenerSpy.mock.calls.some(([registered]) => registered === type),
    `listener ${type} registrado`,
  )
  act(() => {
    window.dispatchEvent(new Event(type))
  })
}

function SessionProbe() {
  const { status, user } = useSession()
  return <p>{`${status}:${user?.username ?? 'nadie'}`}</p>
}

function UnlockControls({ onResult }: { onResult: (result: Result<SessionUser | null>) => void }) {
  const { unlock, signOut } = useSession()
  return (
    <>
      <button onClick={() => void unlock(DEV_PASSWORD).then(onResult)}>desbloquear</button>
      <button onClick={() => void unlock('incorrecta').then(onResult)}>desbloquear mal</button>
      <button onClick={() => void signOut().then(onResult)}>salir</button>
    </>
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  listenerSpy = vi.spyOn(window, 'addEventListener')
  freezeDateAndIntervals('2026-11-12T09:00')
  resetStore()
  nowMs = BASE_NOW_MS
  calls = []
  useClockedBackend()
})

describe('SessionProvider bloqueado', () => {
  it('hidrata como locked sin usuario cuando Rust devuelve la vista bloqueada', async () => {
    mockIPC((cmd) => (cmd === 'current_session' ? { status: 'locked', user: null } : null))

    renderWithProviders(<SessionProbe />)

    expect(await screen.findByText('locked:nadie')).toBeInTheDocument()
  })

  it('session_transitions_to_locked', async () => {
    renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await findSignedInWithPollingArmed('signedIn:recepcion')

    nowMs += IDLE_LOCK_MS
    await advancePollInterval()

    expect(await screen.findByText('locked:nadie')).toBeInTheDocument()
  })

  it('no sondea con la sesión cerrada', async () => {
    renderWithProviders(<SessionProbe />)
    await screen.findByText('signedOut:nadie')
    calls.length = 0

    await advancePollInterval()
    await advancePollInterval()

    expect(SESSION_POLL_INTERVAL_MS).toBe(15_000)
    expect(calls).toEqual([])
  })

  it('sondea la sesión cada 15 segundos con la sesión iniciada', async () => {
    renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await findSignedInWithPollingArmed('signedIn:recepcion')
    calls.length = 0

    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS - 1)
    expect(calls).toEqual([])
    await advancePollInterval()
    expect(calls).toEqual(['current_session'])
  })

  it('session_poll_does_not_call_record_activity', async () => {
    renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await findSignedInWithPollingArmed('signedIn:recepcion')
    calls.length = 0

    await advancePollInterval()
    await advancePollInterval()

    expect(calls.filter((cmd) => cmd === 'current_session')).toHaveLength(2)
    expect(calls).not.toContain('record_activity')
  })

  it('el sondeo no extiende la inactividad', async () => {
    renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await findSignedInWithPollingArmed('signedIn:recepcion')

    nowMs += IDLE_LOCK_MS - MINUTE_MS
    await advancePollInterval()
    expect(calls.filter((cmd) => cmd === 'current_session')).toHaveLength(2)
    nowMs += 2 * MINUTE_MS
    await advancePollInterval()

    expect(await screen.findByText('locked:nadie')).toBeInTheDocument()
  })

  it('un fallo del sondeo conserva la sesión', async () => {
    renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await findSignedInWithPollingArmed('signedIn:recepcion')
    mockIPC(() => Promise.reject(new Error('IPC caído')))

    await advancePollInterval()
    await act(async () => {})

    expect(screen.getByText('signedIn:recepcion')).toBeInTheDocument()
  })

  it('un fallo en la hidratación inicial deja la sesión cerrada', async () => {
    mockIPC(() => Promise.reject(new Error('IPC caído')))

    renderWithProviders(<SessionProbe />, { as: 'recepcion' })

    expect(await screen.findByText('signedOut:nadie')).toBeInTheDocument()
  })

  it('un evento de UI registra actividad y una respuesta locked bloquea la sesión', async () => {
    renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await screen.findByText('signedIn:recepcion')
    nowMs += IDLE_LOCK_MS

    await fireActivity('pointerdown')

    expect(await screen.findByText('locked:nadie')).toBeInTheDocument()
    expect(calls).toContain('record_activity')
  })

  it('record_activity sin sesión en Rust cierra la sesión local', async () => {
    renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await screen.findByText('signedIn:recepcion')
    mockIPC((cmd) => (cmd === 'record_activity' ? null : null))

    await fireActivity('keydown')

    expect(await screen.findByText('signedOut:nadie')).toBeInTheDocument()
  })

  it('un error sessionLocked en una consulta provoca la relectura de la sesión', async () => {
    function FailingQuery() {
      const [isArmed, setIsArmed] = useState(false)
      useQuery({
        queryKey: ['clients'],
        enabled: isArmed,
        queryFn: async () => unwrap(err<string>('sessionLocked', 'Sesión bloqueada')),
      })
      return <button onClick={() => setIsArmed(true)}>consultar</button>
    }
    const { user } = renderWithProviders(
      <>
        <SessionProbe />
        <FailingQuery />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    nowMs += IDLE_LOCK_MS

    await user.click(screen.getByRole('button', { name: 'consultar' }))

    expect(await screen.findByText('locked:nadie')).toBeInTheDocument()
  })

  it('un error sessionLocked en una mutación provoca la relectura de la sesión', async () => {
    function FailingMutation() {
      const mutation = useMutation({ mutationFn: async () => unwrap(err<string>('sessionLocked', 'Sesión bloqueada')) })
      return <button onClick={() => mutation.mutate()}>guardar</button>
    }
    const { user } = renderWithProviders(
      <>
        <SessionProbe />
        <FailingMutation />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    nowMs += IDLE_LOCK_MS

    await user.click(screen.getByRole('button', { name: 'guardar' }))

    expect(await screen.findByText('locked:nadie')).toBeInTheDocument()
  })

  it('un error distinto de sessionLocked no relee la sesión', async () => {
    function FailingQuery() {
      useQuery({ queryKey: ['clients'], queryFn: async () => unwrap(err<string>('notFound', 'No existe')) })
      return null
    }
    renderWithProviders(
      <>
        <SessionProbe />
        <FailingQuery />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    await act(async () => {})

    expect(calls.filter((cmd) => cmd === 'current_session')).toHaveLength(1)
  })
})

describe('caché al bloquear', () => {
  it('session_clears_query_cache_when_locked', async () => {
    const { queryClient } = renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await findSignedInWithPollingArmed('signedIn:recepcion')
    queryClient.setQueryData(['clients'], 'datos-privados')

    nowMs += IDLE_LOCK_MS
    await advancePollInterval()

    expect(await screen.findByText('locked:nadie')).toBeInTheDocument()
    expect(queryClient.getQueryData(['clients'])).toBeUndefined()
  })

  it('no limpia la caché mientras la sesión sigue activa', async () => {
    const { queryClient } = renderWithProviders(<SessionProbe />, { as: 'recepcion' })
    await findSignedInWithPollingArmed('signedIn:recepcion')
    queryClient.setQueryData(['clients'], 'datos-privados')

    await advancePollInterval()
    await act(async () => {})

    expect(queryClient.getQueryData(['clients'])).toBe('datos-privados')
  })
})

describe('unlock y signOut desde locked', () => {
  async function renderLocked() {
    const results: Result<SessionUser | null>[] = []
    const rendered = renderWithProviders(
      <>
        <SessionProbe />
        <UnlockControls onResult={(result) => results.push(result)} />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    nowMs += IDLE_LOCK_MS
    await fireActivity('pointerdown')
    await screen.findByText('locked:nadie')
    return { ...rendered, results }
  }

  it('unlock con la contraseña correcta restaura signedIn con el usuario', async () => {
    const { user } = await renderLocked()

    await user.click(screen.getByRole('button', { name: 'desbloquear' }))

    expect(await screen.findByText('signedIn:recepcion')).toBeInTheDocument()
  })

  it('unlock con contraseña incorrecta devuelve el error y sigue locked', async () => {
    const { user, results } = await renderLocked()

    await user.click(screen.getByRole('button', { name: 'desbloquear mal' }))

    await flushMacrotask()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ status: 'error', error: { code: 'invalidCredentials' } })
    expect(screen.getByText('locked:nadie')).toBeInTheDocument()
  })

  it('signOut desde locked cierra la sesión y limpia la caché', async () => {
    const { user, queryClient } = await renderLocked()
    queryClient.setQueryData(['clients'], 'datos-privados')

    await user.click(screen.getByRole('button', { name: 'salir' }))

    expect(await screen.findByText('signedOut:nadie')).toBeInTheDocument()
    expect(queryClient.getQueryData(['clients'])).toBeUndefined()
    expect(getState().sessionUserId).toBeNull()
  })
})

describe('RequireSession bloqueada', () => {
  function Protected() {
    return (
      <RequireSession>
        <p>contenido protegido</p>
      </RequireSession>
    )
  }

  it('locked_renders_lock_screen', async () => {
    mockIPC((cmd) => (cmd === 'current_session' ? { status: 'locked', user: null } : null))

    renderWithProviders(<Protected />)

    expect(await screen.findByRole('heading', { name: 'Sesión bloqueada' })).toBeInTheDocument()
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('al bloquearse retira el contenido protegido y muestra la pantalla de bloqueo', async () => {
    renderWithProviders(<Protected />, { as: 'recepcion' })
    await screen.findByText('contenido protegido')
    nowMs += IDLE_LOCK_MS
    await fireActivity('pointerdown')
    await screen.findByRole('heading', { name: 'Sesión bloqueada' })
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument()
  })
})
