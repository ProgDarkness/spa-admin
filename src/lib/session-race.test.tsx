import { useQuery } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { SessionView } from '@/lib/model'
import { err, unwrap } from '@/lib/result'
import { createAuthIpcBackend, DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { renderWithProviders } from '@/test/render'
import { useSession } from './session'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

let currentSessionCalls: number
let refreshSession: () => Promise<void>

function installBackendWithDeferredReads(pendingReads: Deferred<SessionView | null>[]): void {
  const backend = createAuthIpcBackend(() => getState().users, {
    read: () => getState().sessionUserId,
    write: (id) => commit({ ...getState(), sessionUserId: id }),
  })
  mockIPC((cmd, args) => {
    if (cmd !== 'current_session') return backend(cmd, args)
    currentSessionCalls += 1
    const pending = pendingReads.shift()
    return pending ? pending.promise : backend(cmd, args)
  })
}

function SessionProbe() {
  const { status, user } = useSession()
  return <p>{`${status}:${user?.username ?? 'nadie'}`}</p>
}

function SessionControls() {
  const { signIn, refresh } = useSession()
  useEffect(() => {
    refreshSession = refresh
  }, [refresh])
  return <button onClick={() => void signIn('lectura', DEV_PASSWORD)}>entrar</button>
}

beforeEach(() => {
  resetStore()
  currentSessionCalls = 0
})

describe('carrera de la carga inicial', () => {
  it('login_during_loading_is_not_overwritten_by_late_initial_response', async () => {
    const initialRead = deferred<SessionView | null>()
    installBackendWithDeferredReads([initialRead])
    const { user } = renderWithProviders(
      <>
        <SessionProbe />
        <SessionControls />
      </>,
    )
    expect(screen.getByText('loading:nadie')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'entrar' }))
    expect(await screen.findByText('signedIn:lectura')).toBeInTheDocument()
    await act(async () => initialRead.resolve(null))

    expect(screen.getByText('signedIn:lectura')).toBeInTheDocument()
  })
})

describe('refresh deduplicado', () => {
  it('refresh_does_not_reuse_a_promise_from_another_generation', async () => {
    renderWithProviders(
      <>
        <SessionProbe />
        <SessionControls />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    const staleRead = deferred<SessionView | null>()
    installBackendWithDeferredReads([staleRead])
    currentSessionCalls = 0
    act(() => {
      void refreshSession()
    })
    await act(async () => screen.getByRole('button', { name: 'entrar' }).click())
    await screen.findByText('signedIn:lectura')

    let secondRefresh: Promise<void> = Promise.resolve()
    act(() => {
      secondRefresh = refreshSession()
    })
    await act(async () => staleRead.resolve(null))
    await act(async () => secondRefresh)

    expect(currentSessionCalls).toBe(2)
    expect(screen.getByText('signedIn:lectura')).toBeInTheDocument()
  })

  it('refresh simultáneo de la misma generación comparte la lectura', async () => {
    renderWithProviders(
      <>
        <SessionProbe />
        <SessionControls />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    const read = deferred<SessionView | null>()
    installBackendWithDeferredReads([read])
    currentSessionCalls = 0

    act(() => {
      void refreshSession()
      void refreshSession()
    })
    await act(async () => read.resolve(null))

    expect(currentSessionCalls).toBe(1)
  })
})

describe('unlock con la sesión ya activa', () => {
  it('unlock_validation_error_triggers_an_immediate_session_refresh', async () => {
    function UnlockButton() {
      const { unlock } = useSession()
      return <button onClick={() => void unlock('cualquiera')}>desbloquear</button>
    }
    installBackendWithDeferredReads([])
    renderWithProviders(
      <>
        <SessionProbe />
        <UnlockButton />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    currentSessionCalls = 0

    await act(async () => screen.getByRole('button', { name: 'desbloquear' }).click())

    await waitFor(() => expect(currentSessionCalls).toBe(1))
  })

  it('unlock sin sesión en Rust relee la sesión y la deja cerrada', async () => {
    function UnlockButton() {
      const { unlock } = useSession()
      return <button onClick={() => void unlock('cualquiera')}>desbloquear</button>
    }
    renderWithProviders(
      <>
        <SessionProbe />
        <UnlockButton />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    commit({ ...getState(), sessionUserId: null })

    await act(async () => screen.getByRole('button', { name: 'desbloquear' }).click())

    expect(await screen.findByText('signedOut:nadie')).toBeInTheDocument()
  })

  it('un error de contraseña incorrecta no relee la sesión', async () => {
    function WrongUnlockButton() {
      const { unlock } = useSession()
      return <button onClick={() => void unlock('mala')}>desbloquear</button>
    }
    installBackendWithDeferredReads([])
    renderWithProviders(<WrongUnlockButton />, { as: 'recepcion' })
    await act(async () => {})
    commit({ ...getState(), sessionUserId: 2 })
    mockIPC((cmd) => {
      if (cmd === 'current_session') currentSessionCalls += 1
      if (cmd === 'unlock') throw { code: 'invalidCredentials', message: 'x', field: null, entityIds: null }
      return null
    })
    currentSessionCalls = 0

    await act(async () => screen.getByRole('button', { name: 'desbloquear' }).click())
    await act(async () => {})

    expect(currentSessionCalls).toBe(0)
  })
})

describe('error unauthenticated', () => {
  it('un error unauthenticated en una consulta provoca la relectura de la sesión', async () => {
    function FailingQuery() {
      const [isArmed, setIsArmed] = useState(false)
      useQuery({
        queryKey: ['clients'],
        enabled: isArmed,
        queryFn: async () => unwrap(err<string>('unauthenticated', 'Debes iniciar sesión')),
      })
      return <button onClick={() => setIsArmed(true)}>consultar</button>
    }
    renderWithProviders(
      <>
        <SessionProbe />
        <FailingQuery />
      </>,
      { as: 'recepcion' },
    )
    await screen.findByText('signedIn:recepcion')
    commit({ ...getState(), sessionUserId: null })

    await act(async () => screen.getByRole('button', { name: 'consultar' }).click())

    expect(await screen.findByText('signedOut:nadie')).toBeInTheDocument()
  })
})
