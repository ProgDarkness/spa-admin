import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { useSession } from '@/lib/session'
import { Providers } from './providers'

function ClientProbe() {
  const client = useQueryClient()
  return <p>{client instanceof QueryClient ? 'client-ok' : 'client-invalid'}</p>
}

describe('Providers', () => {
  it('expone un QueryClient a los hijos', () => {
    render(
      <Providers>
        <ClientProbe />
      </Providers>,
    )
    expect(screen.getByText('client-ok')).toBeInTheDocument()
  })

  it('expone la sesión a los hijos dentro del QueryClientProvider', async () => {
    function SessionStatusProbe() {
      return <p>{`sesion:${useSession().status}`}</p>
    }
    render(
      <Providers>
        <SessionStatusProbe />
      </Providers>,
    )
    expect(screen.getByText('sesion:loading')).toBeInTheDocument()
    expect(await screen.findByText('sesion:signedOut')).toBeInTheDocument()
  })

  it('mantiene la misma instancia de QueryClient entre renders', () => {
    const seen: QueryClient[] = []
    function Collect() {
      seen.push(useQueryClient())
      return null
    }
    const { rerender } = render(
      <Providers>
        <Collect />
      </Providers>,
    )
    rerender(
      <Providers>
        <Collect />
      </Providers>,
    )
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seen).size).toBe(1)
  })

  it('no reintenta las consultas fallidas porque los errores de dominio no son transitorios', () => {
    function RetryProbe() {
      return <p>{`retry:${String(useQueryClient().getDefaultOptions().queries?.retry)}`}</p>
    }
    render(
      <Providers>
        <RetryProbe />
      </Providers>,
    )
    expect(screen.getByText('retry:false')).toBeInTheDocument()
  })
})

describe('Providers en desarrollo dentro del navegador', () => {
  const nativeWindow = window as unknown as { __TAURI_INTERNALS__?: unknown }

  afterEach(() => {
    vi.unstubAllEnvs()
    resetStore()
    clearMocks()
  })

  it('instala el IPC de desarrollo antes del primer currentSession en development sin internals', async () => {
    clearMocks()
    delete nativeWindow.__TAURI_INTERNALS__
    vi.stubEnv('NODE_ENV', 'development')
    commit({ ...getState(), sessionUserId: 1 })
    function SessionStatusProbe() {
      return <p>{`sesion:${useSession().status}`}</p>
    }

    render(
      <Providers>
        <SessionStatusProbe />
      </Providers>,
    )

    expect(await screen.findByText('sesion:signedIn')).toBeInTheDocument()
    expect(nativeWindow.__TAURI_INTERNALS__).toBeDefined()
  })

  it('no monta los hijos hasta que el IPC de desarrollo esta instalado', () => {
    clearMocks()
    delete nativeWindow.__TAURI_INTERNALS__
    vi.stubEnv('NODE_ENV', 'development')

    render(
      <Providers>
        <p>hijo</p>
      </Providers>,
    )

    expect(screen.queryByText('hijo')).not.toBeInTheDocument()
  })

  it('no instala nada cuando NODE_ENV no es development', async () => {
    clearMocks()
    delete nativeWindow.__TAURI_INTERNALS__

    render(
      <Providers>
        <p>hijo</p>
      </Providers>,
    )
    await screen.findByText('hijo')

    expect(nativeWindow.__TAURI_INTERNALS__).toBeUndefined()
  })

  it('monta los hijos y reporta el error si falla la carga del IPC de desarrollo', async () => {
    clearMocks()
    delete nativeWindow.__TAURI_INTERNALS__
    vi.stubEnv('NODE_ENV', 'development')
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.doMock('@/test/ipc/dev-browser-ipc', () => ({
      installDevBrowserIpc: () => {
        throw new Error('carga fallida')
      },
    }))
    vi.resetModules()
    const { Providers: FreshProviders } = await import('./providers')

    render(
      <FreshProviders>
        <p>hijo</p>
      </FreshProviders>,
    )

    expect(await screen.findByText('hijo')).toBeInTheDocument()
    expect(reportError).toHaveBeenCalled()
    vi.doUnmock('@/test/ipc/dev-browser-ipc')
    reportError.mockRestore()
  })
})
