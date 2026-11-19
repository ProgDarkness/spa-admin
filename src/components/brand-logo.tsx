import { cn } from '@/lib/utils'

interface BrandLogoProps {
  className?: string
  size?: number
}

export function BrandLogo({ className, size = 32 }: BrandLogoProps) {
  return (
    <span role="img" aria-label="Spa" className={cn('inline-flex items-center gap-2', className)}>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" width={size} height={size} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}>
        <path d="M16 6.5C19.4 10 19.4 17 16 22.5C12.6 17 12.6 10 16 6.5Z" stroke="currentColor" className="text-primary" />
        <path d="M15 23C10.5 22.6 7 19.2 6.5 14.5C10.5 14.8 13.4 17 15 20" stroke="currentColor" className="text-ring" />
        <path d="M17 23C21.5 22.6 25 19.2 25.5 14.5C21.5 14.8 18.6 17 17 20" stroke="currentColor" className="text-ring" />
      </svg>
      <span aria-hidden="true" className="font-serif leading-none tracking-wide" style={{ fontSize: size * 0.75 }}>
        Spa
      </span>
    </span>
  )
}
