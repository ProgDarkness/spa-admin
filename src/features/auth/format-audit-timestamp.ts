const AUDIT_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/
const MAX_MONTH = 12
const MAX_DAY = 31
const MAX_HOUR = 23
const MAX_MINUTE = 59

function isWithin(value: string, max: number, min = 0): boolean {
  const numeric = Number(value)
  return numeric >= min && numeric <= max
}

export function formatAuditTimestamp(raw: string): string {
  const match = AUDIT_TIMESTAMP_PATTERN.exec(raw)
  if (!match) return raw
  const [, year = '', month = '', day = '', hour = '', minute = ''] = match
  const isReadable =
    isWithin(month, MAX_MONTH, 1) && isWithin(day, MAX_DAY, 1) && isWithin(hour, MAX_HOUR) && isWithin(minute, MAX_MINUTE)
  return isReadable ? `${day}/${month}/${year} ${hour}:${minute}` : raw
}
