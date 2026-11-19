import { useQuery } from '@tanstack/react-query'
import { renderHook, screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it } from 'vitest'
import { currentSession } from '@/features/auth/api'
import { getState, resetStore } from '@/lib/mock/store'
import type { PermissionKey, Result, SessionUser } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { createAuthIpcBackend, DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { routerMock } from '@/test/navigation'
import { renderWithProviders } from '@/test/render'
import { RequireSession, useCan, useSession } from './session'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function SessionProbe() {
  const { status, user } = useSession()
  return <p>{`${status}:${user?.username ?? 'nadie'}`}</p>
}

function CanProbe({ permission }: { permission: PermissionKey }) {
  return <p>{useCan(permission) ? 'permitido' : 'denegado'}</p>
}

function SessionControls() {
  const { signIn, signOut } = useSession()
  return (
    <>
      <button onClick={() => void signIn('lectura', DEV_PASSWORD)}>entrar</button>
      <button onClick={() => void signIn('lectura', 'mala')}>entrar mal</button>
      <button onClick={() => void signOut()}>salir</button>
    </>
  )
}

describe('SessionProvider', () => {
  it('hidrata con la sesión existente', async () => {
    renderWithProviders(<SessionProbe />, { as: 'recepcion' })

    expect(screen.getByText('loading:nadie')).toBeInTheDocument()
    expect(await screen.findByText('signedIn:recepcion')).toBeInTheDocument()
  })

  it('queda signedOut sin sesión previa', async () => {
    renderWithProviders(<SessionProbe />)

    expect(await screen.findByText('signedOut:nadie')).toBeInTheDocument()
  })

  it('signIn válido abre sesión con los permisos del rol', async () => {
    const { user } = renderWithProviders(
      <>
        <SessionProbe />
        <CanProbe permission="clients.write" />
        <CanProbe permission="clients.read" />
        <SessionControls />
      </>,
    )
    await screen.findByText('signedOut:nadie')

    await user.click(screen.getByRole('button', { name: 'entrar' }))

    expect(await screen.findByText('signedIn:lectura')).toBeInTheDocument()
    expect(screen.getByText('denegado')).toBeInTheDocument()
    expect(screen.getByText('permitido')).toBeInTheDocument()
    expect(await currentSession()).toMatchObject({ status: 'ok', data: { username: 'lectura' } })
  })

  it('signIn con clave errónea devuelve invalidCredentials y no cambia el estado', async () => {
    let captured: Result<SessionUser> | null = null
    function Capture() {
      const { signIn } = useSession()
      return (
        <button
          onClick={async () => {
            captured = await signIn('lectura', 'mala')
          }}
        >
          probar
        </button>
      )
    }
    const { user } = renderWithProviders(
      <>
        <SessionProbe />
        <Capture />
      </>,
    )
    await screen.findByText('signedOut:nadie')

    await user.click(screen.getByRole('button', { name: 'probar' }))

    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured).toMatchObject({ status: 'error', error: { code: 'invalidCredentials' } })
    expect(screen.getByText('signedOut:nadie')).toBeInTheDocument()
  })

  it('signOut cierra la sesión y limpia la caché de consultas', async () => {
    function CachedQuery() {
      const query = useQuery({ queryKey: ['clients'], queryFn: async () => 'datos-privados' })
      return <p>{query.data ?? 'sin-datos'}</p>
    }
    const { user, queryClient } = renderWithProviders(
      <>
        <SessionProbe />
        <CachedQuery />
        <SessionControls />
      </>,
      { as: 'propietaria' },
    )
    await screen.findByText('datos-privados')
    expect(queryClient.getQueryData(['clients'])).toBe('datos-privados')

    await user.click(screen.getByRole('button', { name: 'salir' }))

    expect(await screen.findByText('signedOut:nadie')).toBeInTheDocument()
    expect(queryClient.getQueryData(['clients'])).toBeUndefined()
    expect(await currentSession()).toEqual({ status: 'ok', data: null })
  })

  it('signOut con logout fallido conserva sesión y caché, devuelve el error y permite reintentar', async () => {
    let rustSessionId: number | null = 1
    const backend = createAuthIpcBackend(() => getState().users, {
      read: () => rustSessionId,
      write: (id) => {
        rustSessionId = id
      },
    })
    let isLogoutFailing = true
    let captured: Result<null> | null = null
    function CachedQuery() {
      const query = useQuery({ queryKey: ['clients'], queryFn: async () => 'datos-privados' })
      return <p>{query.data ?? 'sin-datos'}</p>
    }
    function Capture() {
      const { signOut } = useSession()
      return (
        <button
          onClick={async () => {
            captured = await signOut()
          }}
        >
          salir
        </button>
      )
    }
    const { user, queryClient } = renderWithProviders(
      <>
        <SessionProbe />
        <CachedQuery />
        <Capture />
      </>,
      { as: 'propietaria' },
    )
    await screen.findByText('datos-privados')
    mockIPC((cmd, args) => {
      if (cmd === 'logout' && isLogoutFailing) throw new Error('pánico')
      return backend(cmd, args)
    })

    await user.click(screen.getByRole('button', { name: 'salir' }))

    await waitFor(() => expect(captured).toMatchObject({ status: 'error', error: { code: 'internal' } }))
    expect(screen.getByText('signedIn:propietaria')).toBeInTheDocument()
    expect(queryClient.getQueryData(['clients'])).toBe('datos-privados')

    isLogoutFailing = false
    await user.click(screen.getByRole('button', { name: 'salir' }))

    expect(await screen.findByText('signedOut:nadie')).toBeInTheDocument()
    expect(queryClient.getQueryData(['clients'])).toBeUndefined()
  })
})

describe('useSession', () => {
  it('lanza fuera de SessionProvider', () => {
    expect(() => renderHook(() => useSession())).toThrow()
  })
})

describe('useCan', () => {
  it('es false para recepcion y true para propietaria en catalog.write', async () => {
    renderWithProviders(<CanProbe permission="catalog.write" />, { as: 'recepcion' })
    await waitFor(() => expect(screen.getByText('denegado')).toBeInTheDocument())
    expect(screen.queryByText('permitido')).not.toBeInTheDocument()
  })

  it('es true para propietaria en catalog.write', async () => {
    renderWithProviders(<CanProbe permission="catalog.write" />, { as: 'propietaria' })

    expect(await screen.findByText('permitido')).toBeInTheDocument()
  })

  it('es false mientras la sesión carga', () => {
    renderWithProviders(<CanProbe permission="catalog.read" />, { as: 'propietaria' })

    expect(screen.getByText('denegado')).toBeInTheDocument()
  })
})

describe('RequireSession', () => {
  it('redirige a /login sin sesión y no renderiza los hijos', async () => {
    renderWithProviders(
      <RequireSession>
        <p>contenido protegido</p>
      </RequireSession>,
    )

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'))
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument()
  })

  it('renderiza los hijos con sesión y no redirige', async () => {
    renderWithProviders(
      <RequireSession>
        <p>contenido protegido</p>
      </RequireSession>,
      { as: 'lectura' },
    )

    expect(await screen.findByText('contenido protegido')).toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })

  it('muestra Cargando… con role status mientras carga y luego deja de mostrarlo', async () => {
    renderWithProviders(
      <RequireSession>
        <p>contenido protegido</p>
      </RequireSession>,
      { as: 'lectura' },
    )

    expect(screen.getByRole('status')).toHaveTextContent('Cargando…')
    expect(await screen.findByText('contenido protegido')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('no muestra Cargando… cuando la sesión está cerrada y redirige', async () => {
    renderWithProviders(
      <RequireSession>
        <p>contenido protegido</p>
      </RequireSession>,
    )

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('no redirige ni muestra hijos mientras carga', () => {
    renderWithProviders(
      <RequireSession>
        <p>contenido protegido</p>
      </RequireSession>,
      { as: 'lectura' },
    )

    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })
})
