import { expect, test, type Page } from '@playwright/test'
import { DEV_PASSWORD } from '../../src/test/ipc/auth-backend'
import { installTauriIpc } from './tauri-ipc'

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

test.beforeEach(async ({ page }) => {
  await installTauriIpc(page)
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
  expect(beforeReload).toMatchObject({ resolved: true, value: { username: 'propietaria' } })

  await page.reload()

  expect(await invokeInPage(page, 'current_session')).toEqual({ resolved: true, value: null })
})

test('logout limpia la sesión', async ({ page }) => {
  await invokeInPage(page, 'login', OWNER_CREDENTIALS)

  await invokeInPage(page, 'logout')

  expect(await invokeInPage(page, 'current_session')).toEqual({ resolved: true, value: null })
})
