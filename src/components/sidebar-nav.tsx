'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, type NavItem } from '@/lib/routes'
import { useCanAny } from '@/lib/session'

function NavLink({ item }: { item: NavItem }) {
  const isAllowed = useCanAny(item.permissions)
  const isActive = usePathname() === item.href
  if (!isAllowed) return null

  return (
    <li className="shrink-0">
      <Link
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        className="block rounded-md border-l-2 border-transparent px-3 py-2 text-sm font-medium lowercase outline-none hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-ring aria-[current=page]:bg-primary-foreground/10"
      >
        {item.label}
      </Link>
    </li>
  )
}

export function SidebarNav() {
  return (
    <nav aria-label="Principal" className="overflow-x-auto md:overflow-visible">
      <ul className="flex gap-1 md:flex-col">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </ul>
    </nav>
  )
}
