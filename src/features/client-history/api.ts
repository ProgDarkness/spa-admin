import { commands } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import type { ClientHistory, Id, Result } from '@/lib/model'

export function getClientHistory(clientId: Id): Promise<Result<ClientHistory>> {
  return settle(() => commands.getClientHistory(clientId))
}
