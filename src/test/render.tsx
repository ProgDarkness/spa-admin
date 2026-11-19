import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import type { SeedUsername } from '@/lib/mock/seed'
import { SessionProvider } from '@/lib/session'
import { signInAs } from './session'

export type RenderWithProvidersOptions = { as?: SeedUsername }

export type RenderWithProvidersResult = RenderResult & { user: UserEvent; queryClient: QueryClient }

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  if (options.as) signInAs(options.as)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{children}</SessionProvider>
      </QueryClientProvider>
    )
  }

  const rendered: RenderResult = render(ui, { wrapper: Wrapper })
  return { ...rendered, user, queryClient }
}
