import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSeed } from '@/lib/mock/seed'
import { resetStore } from '@/lib/mock/store'
import { signInAs } from './session'
import { freezeDate } from './clock'
import { installDevIpc } from './dev-ipc'

const STORE_SEED_DATE = '2031-03-15'
const LATER_CLOCK_DATE = '2044-08-20'
const EXPLICIT_SEED_DATE = '2038-01-05'

type RateRow = { date: string }

async function listedRateDates(): Promise<string[]> {
  const rates = (await invoke('list_rates')) as RateRow[]
  return rates.map((rate) => rate.date).toSorted()
}

function seededRateDates(date: string): string[] {
  return createSeed(date)
    .rates.map((rate) => rate.date)
    .toSorted()
}

beforeEach(() => {
  freezeDate(`${STORE_SEED_DATE}T09:00`)
  resetStore()
  signInAs('recepcion')
})

describe('installDevIpc', () => {
  it('siembra las tasas del IPC con el seed del store actual aunque el reloj ya avanzó', async () => {
    freezeDate(`${LATER_CLOCK_DATE}T09:00`)

    installDevIpc()

    expect(await listedRateDates()).toEqual(seededRateDates(STORE_SEED_DATE))
    expect(seededRateDates(STORE_SEED_DATE)).not.toEqual(seededRateDates(LATER_CLOCK_DATE))
  })

  it('siembra las tasas del IPC con el seed recibido por parámetro', async () => {
    installDevIpc(createSeed(EXPLICIT_SEED_DATE))

    expect(await listedRateDates()).toEqual(seededRateDates(EXPLICIT_SEED_DATE))
  })
})
