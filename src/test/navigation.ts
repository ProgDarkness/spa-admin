import { vi } from 'vitest'

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}

let currentPathname = '/'
let currentSearchParams = new URLSearchParams()

export function setPathname(pathname: string): void {
  currentPathname = pathname
}

export function setSearchParams(params: Record<string, string>): void {
  currentSearchParams = new URLSearchParams(params)
}

export function resetNavigationMock(): void {
  routerMock.push.mockReset()
  routerMock.replace.mockReset()
  routerMock.back.mockReset()
  currentPathname = '/'
  currentSearchParams = new URLSearchParams()
}

export function useRouter() {
  return routerMock
}

export function usePathname(): string {
  return currentPathname
}

export function useSearchParams(): URLSearchParams {
  return currentSearchParams
}

export function redirect(destination: string): never {
  routerMock.replace(destination)
  throw new Error(`NEXT_REDIRECT:${destination}`)
}
