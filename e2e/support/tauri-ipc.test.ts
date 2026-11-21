import { expect, test, type Page } from '@playwright/test'
import { DEV_PASSWORD, IDLE_LOCK_MS } from '../../src/test/ipc/auth-backend'
import {
  EXPECTED_DEV_RESOURCES,
  EXPECTED_DEV_SERVICES,
  resourceIdentitiesOf,
  serviceIdentitiesOf,
} from '../../src/test/ipc/dev-seed-expectations'
import { FIXED_NOW } from './session'
import { installTauriIpc, type TauriIpcHandle } from './tauri-ipc'

type Outcome = { resolved: true; value: unknown } | { resolved: false; isError: boolean; payload: unknown }

async function invokeInPage(page: Page, cmd: string, args?: unknown): Promise<Outcome> {
  return page.evaluate(
    async ([command, payload]) => {
      const host = window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<unknown> } }
      const internals = host.__TAURI_INTERNALS__
      try {
        return { resolved: true as const, value: await internals.invoke(command as string, payload) }
      } catch (caught) {
        return {
          resolved: false as const,
          isError: caught instanceof Error,
          payload: caught instanceof Error ? caught.message : caught,
        }
      }
    },
    [cmd, args] as const,
  )
}

const OWNER_CREDENTIALS = { credentials: { username: 'propietaria', password: DEV_PASSWORD } }

const IDLE_MS = 11 * 60_000

let ipc: TauriIpcHandle

test.beforeEach(async ({ page }) => {
  ipc = await installTauriIpc(page)
  await page.clock.install({ time: FIXED_NOW })
  await page.goto('/login/')
})

test('expone los internals mínimos de Tauri antes de que cargue la app', async ({ page }) => {
  const shape = await page.evaluate(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__
    return {
      invoke: typeof internals.invoke,
      transformCallback: typeof internals.transformCallback,
      metadata: internals.metadata,
    }
  })

  expect(shape).toEqual({
    invoke: 'function',
    transformCallback: 'function',
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  })
})

test('login devuelve el usuario sin contraseña', async ({ page }) => {
  const outcome = await invokeInPage(page, 'login', OWNER_CREDENTIALS)

  expect(outcome).toMatchObject({ resolved: true, value: { id: 1, username: 'propietaria' } })
  expect(JSON.stringify(outcome)).not.toContain(DEV_PASSWORD)
})

test('las credenciales inválidas rechazan con el objeto de error plano', async ({ page }) => {
  const outcome = await invokeInPage(page, 'login', { credentials: { username: 'propietaria', password: 'mala' } })

  expect(outcome).toEqual({
    resolved: false,
    isError: false,
    payload: { code: 'invalidCredentials', message: 'Usuario o contraseña incorrectos', field: null, entityIds: null },
  })
})

test('un comando desconocido rechaza con un Error', async ({ page }) => {
  const outcome = await invokeInPage(page, 'otro_comando')

  expect(outcome).toEqual({ resolved: false, isError: true, payload: 'IPC no simulado: otro_comando' })
})

test('la sesión se mantiene durante la página y se descarta al recargar (D21)', async ({ page }) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)
  const beforeReload = await invokeInPage(page, 'current_session')
  expect(beforeReload).toMatchObject({ resolved: true, value: { status: 'active', user: { username: 'propietaria' } } })

  await page.reload()

  expect(await invokeInPage(page, 'current_session')).toEqual({ resolved: true, value: null })
})

test('logout limpia la sesión', async ({ page }) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)

  await invokeInPage(page, 'logout')

  expect(await invokeInPage(page, 'current_session')).toEqual({ resolved: true, value: null })
})

test('record_activity extiende la sesión y devuelve la vista activa', async ({ page }) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)

  const outcome = await invokeInPage(page, 'record_activity')

  expect(outcome).toMatchObject({ resolved: true, value: { status: 'active', user: { username: 'propietaria' } } })
})

test('la inactividad del reloj inyectado bloquea la sesión sin cerrarla', async ({ page }) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)

  await ipc.advanceClock(IDLE_MS)

  expect(await invokeInPage(page, 'current_session')).toEqual({
    resolved: true,
    value: { status: 'locked', user: null },
  })
})

test('unlock con la contraseña correcta reactiva la sesión bloqueada', async ({ page }) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)
  await ipc.advanceClock(IDLE_MS)
  await invokeInPage(page, 'current_session')

  const wrong = await invokeInPage(page, 'unlock', { credentials: { password: 'mala' } })
  const right = await invokeInPage(page, 'unlock', { credentials: { password: DEV_PASSWORD } })

  expect(wrong).toMatchObject({ resolved: false, payload: { code: 'invalidCredentials' } })
  expect(right).toMatchObject({ resolved: true, value: { username: 'propietaria' } })
})

test('setup_status informa que no falta la propietaria con los usuarios de ejemplo', async ({ page }) => {
  expect(await invokeInPage(page, 'setup_status')).toEqual({
    resolved: true,
    value: { needsOwner: false, clockRollback: null },
  })
})

test('list_services exige sesión y con la propietaria lista los servicios de ejemplo con sus nombres', async ({ page }) => {
  const filter = { filter: { includeInactive: true } }

  expect(await invokeInPage(page, 'list_services', filter)).toMatchObject({
    resolved: false,
    isError: false,
    payload: { code: 'unauthenticated' },
  })
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)
  const listed = await invokeInPage(page, 'list_services', filter)

  expect(listed.resolved && serviceIdentitiesOf(listed.value)).toEqual(EXPECTED_DEV_SERVICES)
})

test('list_resources exige sesión y con la propietaria lista Cabina 1, Cabina 2 y Manicure (Rosa) inactivo', async ({ page }) => {
  const filter = { filter: { includeInactive: true } }

  expect(await invokeInPage(page, 'list_resources', filter)).toMatchObject({
    resolved: false,
    isError: false,
    payload: { code: 'unauthenticated' },
  })
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)
  const listed = await invokeInPage(page, 'list_resources', filter)

  expect(listed.resolved && resourceIdentitiesOf(listed.value)).toEqual(EXPECTED_DEV_RESOURCES)
})

const THRESHOLD_MARGIN_MS = 5_000

test('el reloj del backend es el del navegador: avanzar solo el navegador bloquea la sesión inactiva', async ({
  page,
}) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)

  await page.clock.fastForward(IDLE_MS)

  expect(await invokeInPage(page, 'current_session')).toEqual({
    resolved: true,
    value: { status: 'locked', user: null },
  })
})

test('el backend bloquea al cruzar el umbral de inactividad medido en el reloj fijado del navegador', async ({
  page,
}) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)

  await page.clock.fastForward(IDLE_LOCK_MS - THRESHOLD_MARGIN_MS)
  const beforeThreshold = await invokeInPage(page, 'current_session')
  await page.clock.fastForward(2 * THRESHOLD_MARGIN_MS)
  const afterThreshold = await invokeInPage(page, 'current_session')

  expect(beforeThreshold).toMatchObject({ resolved: true, value: { status: 'active' } })
  expect(afterThreshold).toEqual({ resolved: true, value: { status: 'locked', user: null } })
})

test('advanceClock mueve a la vez el reloj del navegador y el del backend', async ({ page }) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)
  const browserBefore = await page.evaluate(() => Date.now())

  await ipc.advanceClock(IDLE_MS)

  const browserAfter = await page.evaluate(() => Date.now())
  expect(browserAfter - browserBefore).toBeGreaterThanOrEqual(IDLE_MS)
  expect(await invokeInPage(page, 'current_session')).toEqual({
    resolved: true,
    value: { status: 'locked', user: null },
  })
})

test('waitForReply resuelve de inmediato si el backend ya respondió al comando', async () => {
  await ipc.waitForReply('setup_status')
})

test('waitForReply no resuelve mientras el backend retiene la respuesta y resuelve al liberarla', async ({
  context,
}) => {
  const heldPage = await context.newPage()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let markRequested: () => void = () => undefined
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve
  })
  const heldIpc = await installTauriIpc(heldPage, {
    overrides: {
      setup_status: async () => {
        markRequested()
        await gate
        return { needsOwner: false, clockRollback: null }
      },
    },
  })
  let hasReplied = false
  const reply = heldIpc.waitForReply('setup_status').then(() => {
    hasReplied = true
  })

  await heldPage.goto('/login/')
  await requested
  await heldPage.waitForTimeout(100)
  const repliedWhileHeld = hasReplied
  release()
  await reply

  expect(repliedWhileHeld).toBe(false)
  expect(hasReplied).toBe(true)
})
