import type { Metadata } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import { Providers } from './providers'
import './globals.css'

const serif = localFont({
  src: './fonts/newsreader-variable.ttf',
  variable: '--font-newsreader',
  display: 'swap',
  weight: '200 800',
})

const sans = localFont({
  src: './fonts/hanken-grotesk-variable.ttf',
  variable: '--font-hanken-grotesk',
  display: 'swap',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: 'Spa',
  description: 'Gestión de citas, clientes y pagos',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
