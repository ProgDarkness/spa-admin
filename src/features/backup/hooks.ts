import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query'
import { useCallback } from 'react'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { exportBackup, getBackupStatus, restoreBackup } from './api'

export const BACKUP_STATUS_STALE_MS = 5 * 60 * 1000
export const BACKUP_STATUS_REFETCH_MS = 60 * 60 * 1000

export function useBackupStatus() {
  return useQuery({
    queryKey: [QUERY_KEYS.backupStatus],
    queryFn: async () => unwrap(await getBackupStatus()),
    staleTime: BACKUP_STATUS_STALE_MS,
    refetchInterval: BACKUP_STATUS_REFETCH_MS,
    refetchOnWindowFocus: true,
  })
}

function usePassphraseMutation<TData>(options: UseMutationOptions<TData, Error, string>) {
  const { mutateAsync, reset } = useMutation({ ...options, gcTime: 0 })

  const mutateAndForgetPassphrase = useCallback(
    async (passphrase: string): Promise<TData> => {
      try {
        return await mutateAsync(passphrase)
      } finally {
        reset()
      }
    },
    [mutateAsync, reset],
  )

  return { mutateAsync: mutateAndForgetPassphrase }
}

export function useExportBackup() {
  const queryClient = useQueryClient()
  return usePassphraseMutation({
    mutationFn: async (passphrase: string) => unwrap(await exportBackup(passphrase)),
    onSuccess: (exported) => {
      if (exported !== null) return queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.backupStatus] })
    },
  })
}

export function useRestoreBackup() {
  const queryClient = useQueryClient()
  return usePassphraseMutation({
    mutationFn: async (passphrase: string) => unwrap(await restoreBackup(passphrase)),
    onSuccess: (restored) => {
      if (restored !== null) queryClient.clear()
    },
  })
}
