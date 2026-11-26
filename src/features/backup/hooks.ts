import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QUERY_KEYS } from '@/lib/query-keys'
import { unwrap } from '@/lib/result'
import { exportBackup, getBackupStatus, restoreBackup } from './api'

export function useBackupStatus() {
  return useQuery({
    queryKey: [QUERY_KEYS.backupStatus],
    queryFn: async () => unwrap(await getBackupStatus()),
  })
}

export function useExportBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (passphrase: string) => unwrap(await exportBackup(passphrase)),
    onSuccess: (exported) => {
      if (exported !== null) return queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.backupStatus] })
    },
  })
}

export function useRestoreBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (passphrase: string) => unwrap(await restoreBackup(passphrase)),
    onSuccess: (restored) => {
      if (restored !== null) queryClient.clear()
    },
  })
}
