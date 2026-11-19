import { useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { useSession } from '@/lib/session'
import RootLayout, { metadata } from './layout'

const fontMock = vi.hoisted(() => ({ calls: 0 }))

vi.mock('next/font/local', () => ({
  default: () => {
    fontMock.calls += 1
    return { className: `font-class-${fontMock.calls}`, variable: `font-variable-${fontMock.calls}` }
  },
}))

function ProviderProbe() {
  useQueryClient()
  useSession()
  return <span>hijo-con-providers</span>
}

describe('RootLayout', () => {
  it('renderiza html en español con los hijos dentro de Providers', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <ProviderProbe />
      </RootLayout>,
    )
    expect(markup).toMatch(/<html lang="es"[^>]*>/)
    expect(markup).toContain('<body>')
    expect(markup).toContain('hijo-con-providers')
  })

  it('aplica en html las clases variable de las dos fuentes locales', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <span>hijo</span>
      </RootLayout>,
    )
    const htmlClass = /<html[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? ''
    expect(htmlClass).toContain('font-variable-1')
    expect(htmlClass).toContain('font-variable-2')
  })

  it('declara metadata de la aplicación', () => {
    expect(metadata.title).toBe('Spa')
  })
})
