import type { ReactNode } from 'react'
import { BrandLogo } from '@/components/brand-logo'
import { SidebarNav } from './sidebar-nav'
import { ShellBanners } from './shell-banners'
import { UserSummary } from './user-summary'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <aside className="flex flex-col gap-3 bg-primary px-4 py-3 text-primary-foreground md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:gap-8 md:py-6">
        <BrandLogo className="[&_svg_path]:stroke-primary-foreground" />
        <SidebarNav />
        <div className="md:mt-auto">
          <UserSummary />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellBanners />
        <main className="flex-1 p-6 md:p-10">{children}</main>
      </div>
    </div>
  )
}
