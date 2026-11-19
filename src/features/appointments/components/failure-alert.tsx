import type { AppError } from '@/lib/model'
import { fieldErrorOf } from '../labels'

type FailureAlertProps = { failure: AppError | null; formFields: readonly string[] }

export function FailureAlert({ failure, formFields }: FailureAlertProps) {
  if (!failure) return null
  const isShownByField = fieldErrorOf(failure, formFields) !== null
  const hasConflicts = failure.entityIds !== null && failure.entityIds.length > 0
  if (isShownByField && !hasConflicts) return null
  return (
    <div role="alert" data-tone="error" className="grid gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
      {isShownByField ? null : <p>{failure.message}</p>}
      {hasConflicts ? <p>{`Citas en conflicto: ${failure.entityIds?.map((id) => `#${id}`).join(', ')}`}</p> : null}
    </div>
  )
}
