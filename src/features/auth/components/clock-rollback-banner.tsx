import { formatAuditTimestamp } from '../format-audit-timestamp'

type ClockRollbackBannerProps = { lastRecordedAt: string; detectedAt: string }

export function ClockRollbackBanner({ lastRecordedAt, detectedAt }: ClockRollbackBannerProps) {
  return (
    <p role="alert" className="w-full rounded-md border border-destructive bg-card p-3 text-sm text-destructive">
      La fecha del equipo retrocedió. Último registro: {formatAuditTimestamp(lastRecordedAt)}. Fecha detectada:{' '}
      {formatAuditTimestamp(detectedAt)}. Revisa el reloj del equipo antes de registrar citas o pagos.
    </p>
  )
}
