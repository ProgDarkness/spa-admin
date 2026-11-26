import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import { appErrorOf } from '@/lib/result'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { setNextPickedBackup } from '@/test/ipc/backup-backend'
import { signInAs } from '@/test/session'
import {
  BACKUP_STATUS_REFETCH_MS,
  BACKUP_STATUS_STALE_MS,
  useBackupStatus,
  useExportBackup,
  useRestoreBackup,
} from './hooks'

const PASSPHRASE = 'frase de prueba larga'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
  setNextPickedBackup('valid')
})

afterEach(() => setNextPickedBackup('valid'))

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, wrapper: Wrapper }
}

describe('useBackupStatus', () => {
  it('consulta bajo la clave backupStatus', async () => {
    signInAs('propietaria')
    const { queryClient, wrapper } = setup()

    const { result } = renderHook(() => useBackupStatus(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ lastBackupAt: null, isDue: true })
    expect(queryClient.getQueryData(['backupStatus'])).toBe(result.current.data)
  })

  it('expone el AppError forbidden como error de la consulta', async () => {
    signInAs('recepcion')
    const { wrapper } = setup()

    const { result } = renderHook(() => useBackupStatus(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(appErrorOf(result.current.error)?.code).toBe('forbidden')
  })
})

describe('useExportBackup', () => {
  it('exportar invalida el estado y deja de estar vencido', async () => {
    signInAs('propietaria')
    const { wrapper } = setup()
    const { result } = renderHook(() => ({ status: useBackupStatus(), exporter: useExportBackup() }), { wrapper })
    await waitFor(() => expect(result.current.status.data?.isDue).toBe(true))

    await act(async () => {
      await result.current.exporter.mutateAsync(PASSPHRASE)
    })

    await waitFor(() => expect(result.current.status.data?.isDue).toBe(false))
    expect(result.current.status.data?.lastBackupAt).toBe('2026-11-12T09:00:00')
  })

  it('devuelve el archivo creado', async () => {
    signInAs('propietaria')
    const { wrapper } = setup()
    const { result } = renderHook(() => useExportBackup(), { wrapper })

    let exported: unknown
    await act(async () => {
      exported = await result.current.mutateAsync(PASSPHRASE)
    })

    expect(exported).toEqual({ fileName: 'spa-respaldo-2026-11-12-0900.spabak', createdAt: '2026-11-12T09:00:00' })
  })

  it('cancelar el diálogo devuelve null y no invalida el estado', async () => {
    signInAs('propietaria')
    setNextPickedBackup(null)
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useExportBackup(), { wrapper })
    queryClient.setQueryData(['backupStatus'], { lastBackupAt: null, isDue: true })

    let exported: unknown = 'sin respuesta'
    await act(async () => {
      exported = await result.current.mutateAsync(PASSPHRASE)
    })

    expect(exported).toBeNull()
    expect(queryClient.getQueryState(['backupStatus'])?.isInvalidated).toBe(false)
  })

  it('un error de dominio rechaza la mutación con el AppError', async () => {
    signInAs('recepcion')
    const { wrapper } = setup()
    const { result } = renderHook(() => useExportBackup(), { wrapper })

    let rejection: unknown
    await act(async () => {
      rejection = await result.current.mutateAsync(PASSPHRASE).catch((caught: unknown) => caught)
    })

    expect(appErrorOf(rejection)?.code).toBe('forbidden')
  })
})

describe('useRestoreBackup', () => {
  it('restaurar vacía toda la caché de consultas y termina la sesión', async () => {
    signInAs('propietaria')
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['clients'], [{ id: 1 }])
    queryClient.setQueryData(['backupStatus'], { lastBackupAt: null, isDue: true })
    const { result } = renderHook(() => useRestoreBackup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(PASSPHRASE)
    })

    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(getState().sessionUserId).toBeNull()
  })

  it('tras vaciar la caché la mutación sigue informando éxito con las versiones', async () => {
    signInAs('propietaria')
    const { wrapper } = setup()
    const { result } = renderHook(() => useRestoreBackup(), { wrapper })

    let restored: unknown
    await act(async () => {
      restored = await result.current.mutateAsync(PASSPHRASE)
    })

    expect(restored).toEqual({ sourceSchemaVersion: 12, schemaVersion: 12 })
  })

  it('cancelar el diálogo devuelve null y conserva la caché', async () => {
    signInAs('propietaria')
    setNextPickedBackup(null)
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['clients'], [{ id: 1 }])
    const { result } = renderHook(() => useRestoreBackup(), { wrapper })

    let restored: unknown = 'sin respuesta'
    await act(async () => {
      restored = await result.current.mutateAsync(PASSPHRASE)
    })

    expect(restored).toBeNull()
    expect(queryClient.getQueryData(['clients'])).toEqual([{ id: 1 }])
    expect(getState().sessionUserId).not.toBeNull()
  })

  it.each([
    ['corrupt', 'backupUnreadable'],
    ['notRecognized', 'backupNotRecognized'],
    ['future', 'backupFromNewerApp'],
  ] as const)('un respaldo %s falla con %s y conserva caché y sesión', async (pick, code) => {
    signInAs('propietaria')
    setNextPickedBackup(pick)
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['clients'], [{ id: 1 }])
    const { result } = renderHook(() => useRestoreBackup(), { wrapper })

    let rejection: unknown
    await act(async () => {
      rejection = await result.current.mutateAsync(PASSPHRASE).catch((caught: unknown) => caught)
    })

    expect(appErrorOf(rejection)?.code).toBe(code)
    expect(queryClient.getQueryData(['clients'])).toEqual([{ id: 1 }])
    expect(getState().sessionUserId).not.toBeNull()
  })
})

function mutationStatesOf(queryClient: QueryClient): string {
  return JSON.stringify(queryClient.getMutationCache().getAll().map((mutation) => mutation.state))
}

describe('la frase no queda en la caché de mutaciones', () => {
  it('tras exportar con éxito', async () => {
    signInAs('propietaria')
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useExportBackup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(PASSPHRASE)
    })

    await waitFor(() => expect(mutationStatesOf(queryClient)).not.toContain(PASSPHRASE))
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('tras fallar al exportar', async () => {
    signInAs('recepcion')
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useExportBackup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(PASSPHRASE).catch(() => undefined)
    })

    await waitFor(() => expect(mutationStatesOf(queryClient)).not.toContain(PASSPHRASE))
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('tras cancelar el diálogo de exportar', async () => {
    signInAs('propietaria')
    setNextPickedBackup(null)
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useExportBackup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(PASSPHRASE)
    })

    await waitFor(() => expect(mutationStatesOf(queryClient)).not.toContain(PASSPHRASE))
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('tras restaurar con éxito', async () => {
    signInAs('propietaria')
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useRestoreBackup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(PASSPHRASE)
    })

    await waitFor(() => expect(mutationStatesOf(queryClient)).not.toContain(PASSPHRASE))
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('tras fallar al restaurar', async () => {
    signInAs('propietaria')
    setNextPickedBackup('corrupt')
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useRestoreBackup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(PASSPHRASE).catch(() => undefined)
    })

    await waitFor(() => expect(mutationStatesOf(queryClient)).not.toContain(PASSPHRASE))
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('tras cancelar el diálogo de restaurar', async () => {
    signInAs('propietaria')
    setNextPickedBackup(null)
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useRestoreBackup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(PASSPHRASE)
    })

    await waitFor(() => expect(mutationStatesOf(queryClient)).not.toContain(PASSPHRASE))
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('mientras la operación está en curso la frase sí viaja en las variables', async () => {
    signInAs('propietaria')
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useExportBackup(), { wrapper })

    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.mutateAsync(PASSPHRASE)
    })
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1)
    await act(async () => {
      await pending
    })
  })
})

describe('useBackupStatus: frescura', () => {
  it('declara tiempo de frescura y refresco horario, y refresca al enfocar', async () => {
    signInAs('propietaria')
    const { queryClient, wrapper } = setup()
    renderHook(() => useBackupStatus(), { wrapper })

    await waitFor(() => expect(queryClient.getQueryData(['backupStatus'])).toBeDefined())
    const options = queryClient.getQueryCache().find({ queryKey: ['backupStatus'] })?.observers[0]?.options

    expect(options?.staleTime).toBe(BACKUP_STATUS_STALE_MS)
    expect(options?.refetchInterval).toBe(BACKUP_STATUS_REFETCH_MS)
    expect(options?.refetchOnWindowFocus).toBe(true)
  })
})
