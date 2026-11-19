'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ClientHistoryView } from '@/features/client-history/components/client-history-view'
import { ClientNotFound } from '@/features/client-history/components/client-not-found'

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/

function ClientRecord() {
  const rawId = useSearchParams().get('id') ?? ''
  if (!POSITIVE_INTEGER_PATTERN.test(rawId)) return <ClientNotFound />
  return <ClientHistoryView clientId={Number(rawId)} />
}

export default function ClientRecordPage() {
  return (
    <Suspense fallback={<p>Cargando ficha…</p>}>
      <ClientRecord />
    </Suspense>
  )
}
