import type { ReactNode } from 'react'
import { BrandLogo } from '@/components/brand-logo'

type AuthCardProps = { title: string; children: ReactNode }

export function AuthCard({ title, children }: AuthCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section
        aria-labelledby="auth-heading"
        className="flex w-full max-w-sm flex-col items-center gap-6 rounded-lg border border-border bg-card p-8 text-card-foreground"
      >
        <BrandLogo size={56} />
        <h1 id="auth-heading" className="font-serif text-2xl font-semibold">
          {title}
        </h1>
        {children}
      </section>
    </main>
  )
}
