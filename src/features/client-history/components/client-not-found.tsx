import Link from 'next/link'
import { ROUTES } from '@/lib/routes'

export function ClientNotFound() {
  return (
    <section data-slot="empty-state" className="mx-auto grid max-w-md justify-items-center gap-3 rounded-md border border-border bg-card p-8 text-center">
      <h1 className="font-serif text-2xl font-semibold">Cliente no encontrado</h1>
      <p>El cliente solicitado no existe o el enlace no es válido.</p>
      <Link href={ROUTES.clients} className="w-fit text-primary underline underline-offset-4 hover:text-ring">
        Volver a clientes
      </Link>
    </section>
  )
}
