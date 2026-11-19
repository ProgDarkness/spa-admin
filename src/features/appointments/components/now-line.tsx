type NowLineProps = { offset: number }

const PERCENT = 100

export function NowLine({ offset }: NowLineProps) {
  return (
    <div
      data-now-line
      role="presentation"
      style={{ top: `${offset * PERCENT}%` }}
      className="pointer-events-none absolute inset-x-0 h-px bg-ring motion-safe:animate-pulse"
    />
  )
}
