import type { Client } from '@/lib/model'

const COMBINING_MARKS = /\p{M}/gu

export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()
}

export function matchesClientQuery(client: Client, normalizedQuery: string): boolean {
  const searchableFields = [client.firstName, client.lastName, client.nationalId, client.phone]
  return searchableFields.some((field) => normalizeSearchText(field).includes(normalizedQuery))
}
