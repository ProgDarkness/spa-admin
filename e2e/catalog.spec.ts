import { expect, test, type Locator, type Page } from '@playwright/test'
import { FIXED_TODAY, goToSection, signInAs } from './support/session'

const NEW_SERVICE = { name: 'Reflexología podal', price: '25,00', durationMin: '45' }
const EDITED_SERVICE = { name: 'Reflexología integral', price: '31,50', durationMin: '60' }
const NEW_RESOURCE = 'Sala de prueba'
const NEW_METHOD = 'Billetera digital'
const NEW_RATE = '40,00'
const MISSING_RATE_DAY = new Date('2026-11-20T09:00:00-04:00')
const MISSING_RATE_ISO_DAY = MISSING_RATE_DAY.toISOString().slice(0, 10)
const MISSING_RATE_ALERT = /Falta la tasa de cambio de hoy/
const FORBIDDEN_ERROR = { code: 'forbidden', message: 'No tienes permiso para esta acción' }

function rowOf(page: Page, text: string): Locator {
  return page.getByRole('row').filter({ hasText: text })
}

const NEXT_ROUTER_MISSING = 'window.next.router no está disponible: el helper depende del router interno de Next'

async function navigateViaNextRouter(page: Page, path: string, headingName: string): Promise<void> {
  await page.evaluate(
    ([target, missingMessage]) => {
      const host = window as unknown as { next?: { router?: { push(href: string): void } } }
      if (typeof host.next?.router?.push !== 'function') throw new Error(missingMessage)
      host.next.router.push(target)
    },
    [path, NEXT_ROUTER_MISSING] as const,
  )
  await expect(page.getByRole('heading', { level: 1, name: headingName })).toBeVisible()
}

async function invokeCommand(page: Page, command: string, args: unknown): Promise<unknown> {
  return page.evaluate(
    async ([cmd, payload]) => {
      const host = window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<unknown> } }
      try {
        return { resolved: true, value: await host.__TAURI_INTERNALS__.invoke(cmd as string, payload) }
      } catch (caught) {
        return { resolved: false, payload: caught }
      }
    },
    [command, args] as const,
  )
}

interface NamedRecord {
  name: string
}

interface RateRecord {
  date: string
  rateBsPerUsdE4: number
}

interface DataSnapshot {
  resources: NamedRecord[]
  paymentMethods: NamedRecord[]
  rates: RateRecord[]
}

async function listOf<T>(page: Page, command: string, args: unknown): Promise<T[]> {
  const outcome = (await invokeCommand(page, command, args)) as { resolved: boolean; value: T[] }
  expect(outcome.resolved).toBe(true)
  return outcome.value
}

async function snapshotData(page: Page): Promise<DataSnapshot> {
  const filter = { filter: { includeInactive: true } }
  return {
    resources: await listOf<NamedRecord>(page, 'list_resources', filter),
    paymentMethods: await listOf<NamedRecord>(page, 'list_payment_methods', filter),
    rates: await listOf<RateRecord>(page, 'list_rates', undefined),
  }
}

async function fillServiceForm(dialog: Locator, values: typeof NEW_SERVICE): Promise<void> {
  await dialog.getByLabel('Nombre').fill(values.name)
  await dialog.getByLabel('Precio (USD)').fill(values.price)
  await dialog.getByLabel('Duración (minutos)').fill(values.durationMin)
}

test.describe('propietaria: catálogo', () => {
  test('crea un servicio, aparece en la lista y al editarlo se ve el cambio', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Catálogo')

    await page.getByRole('button', { name: 'Nuevo servicio' }).click()
    const creation = page.getByRole('dialog', { name: 'Nuevo servicio' })
    await fillServiceForm(creation, NEW_SERVICE)
    await creation.getByRole('button', { name: 'Crear servicio' }).click()

    await expect(creation).toBeHidden()
    const created = rowOf(page, NEW_SERVICE.name)
    await expect(created).toBeVisible()
    await expect(created).toContainText('25,00')
    await expect(created).toContainText('45 min')
    await expect(created).toContainText('Activo')

    await page.getByRole('button', { name: `Editar ${NEW_SERVICE.name}` }).click()
    const edition = page.getByRole('dialog', { name: 'Editar servicio' })
    await expect(edition.getByLabel('Nombre')).toHaveValue(NEW_SERVICE.name)
    await fillServiceForm(edition, EDITED_SERVICE)
    await edition.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(edition).toBeHidden()
    const edited = rowOf(page, EDITED_SERVICE.name)
    await expect(edited).toContainText('31,50')
    await expect(edited).toContainText('60 min')
    await expect(rowOf(page, NEW_SERVICE.name)).toHaveCount(0)
  })

  test('un precio inválido muestra el error y no crea el servicio', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Catálogo')

    await page.getByRole('button', { name: 'Nuevo servicio' }).click()
    const creation = page.getByRole('dialog', { name: 'Nuevo servicio' })
    await fillServiceForm(creation, { ...NEW_SERVICE, price: 'abc' })
    await creation.getByRole('button', { name: 'Crear servicio' }).click()

    await expect(creation.getByText('Ingresa un precio válido')).toBeVisible()
    await expect(rowOf(page, NEW_SERVICE.name)).toHaveCount(0)
  })
})

test.describe('propietaria: recursos', () => {
  test('desactiva un recurso con confirmación: queda inactivo y deja de ofrecerse al agendar', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Recursos')

    await page.getByRole('button', { name: 'Nuevo recurso' }).click()
    const creation = page.getByRole('dialog', { name: 'Nuevo recurso' })
    await creation.getByLabel('Nombre').fill(NEW_RESOURCE)
    await creation.getByRole('button', { name: 'Crear' }).click()
    await expect(creation).toBeHidden()
    await expect(rowOf(page, NEW_RESOURCE)).toContainText('Activo')

    await page.getByRole('button', { name: `Desactivar ${NEW_RESOURCE}` }).click()
    const confirmation = page.getByRole('dialog', { name: `Desactivar ${NEW_RESOURCE}` })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancelar' }).click()
    await expect(rowOf(page, NEW_RESOURCE)).toContainText('Activo')

    await page.getByRole('button', { name: `Desactivar ${NEW_RESOURCE}` }).click()
    await confirmation.getByRole('button', { name: 'Desactivar' }).click()
    await expect(confirmation).toBeHidden()
    await expect(rowOf(page, NEW_RESOURCE)).toContainText('Inactivo')
    await expect(page.getByRole('button', { name: `Reactivar ${NEW_RESOURCE}` })).toBeVisible()

    await page.getByLabel('Mostrar inactivos').uncheck()
    await expect(rowOf(page, NEW_RESOURCE)).toHaveCount(0)
    await expect(rowOf(page, 'Cabina 1')).toBeVisible()

    await goToSection(page, 'Citas')
    await page.getByRole('button', { name: 'Nueva cita' }).click()
    const appointment = page.getByRole('dialog', { name: 'Nueva cita' })
    const resourceOptions = appointment.getByLabel('Recurso').getByRole('option')
    await expect(resourceOptions.filter({ hasText: 'Cabina 1' })).toHaveCount(1)
    await expect(resourceOptions.filter({ hasText: NEW_RESOURCE })).toHaveCount(0)
  })
})

test.describe('propietaria: tasas', () => {
  test('guardar la tasa del día hace desaparecer el banner de tasa faltante', async ({ page }) => {
    await signInAs(page, 'propietaria', { now: MISSING_RATE_DAY })

    const banner = page.getByRole('alert').filter({ hasText: MISSING_RATE_ALERT })
    await expect(banner).toBeVisible()

    await banner.getByRole('link', { name: 'Registrar tasa' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Tasas de cambio' })).toBeVisible()
    await expect(page.getByLabel('Fecha')).toHaveValue(MISSING_RATE_ISO_DAY)
    await expect(rowOf(page, MISSING_RATE_ISO_DAY)).toHaveCount(0)

    await page.getByLabel('Tasa (Bs por USD)').fill(NEW_RATE)
    await page.getByRole('button', { name: 'Guardar tasa' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Tasa guardada' })).toBeVisible()
    await expect(rowOf(page, MISSING_RATE_ISO_DAY)).toContainText(NEW_RATE)
    await expect(page.getByRole('alert').filter({ hasText: MISSING_RATE_ALERT })).toHaveCount(0)
  })

  test('con la tasa del día ya registrada no aparece el banner', async ({ page }) => {
    const ipc = await signInAs(page, 'propietaria')
    await goToSection(page, 'Tasas')
    await ipc.waitForReply('get_rate')

    await expect(rowOf(page, FIXED_TODAY)).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: MISSING_RATE_ALERT })).toHaveCount(0)
  })
})

test.describe('propietaria: métodos de pago', () => {
  test('crea un método y lo desactiva con confirmación', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Métodos de pago')

    await page.getByRole('button', { name: 'Nuevo método de pago' }).click()
    const creation = page.getByRole('dialog', { name: 'Nuevo método de pago' })
    await creation.getByLabel('Nombre').fill(NEW_METHOD)
    await creation.getByRole('button', { name: 'Crear' }).click()
    await expect(creation).toBeHidden()
    await expect(rowOf(page, NEW_METHOD)).toContainText('Activo')

    await page.getByRole('button', { name: `Desactivar ${NEW_METHOD}` }).click()
    const confirmation = page.getByRole('dialog', { name: `Desactivar ${NEW_METHOD}` })
    await confirmation.getByRole('button', { name: 'Desactivar' }).click()
    await expect(confirmation).toBeHidden()
    await expect(rowOf(page, NEW_METHOD)).toContainText('Inactivo')

    await page.getByLabel('Mostrar inactivos').uncheck()
    await expect(rowOf(page, NEW_METHOD)).toHaveCount(0)
  })
})

test.describe('helpers de navegación', () => {
  test('navigateViaNextRouter falla con un mensaje claro si el router interno de Next no existe', async ({ page }) => {
    await page.goto('about:blank')

    await expect(navigateViaNextRouter(page, '/ajustes/recursos/', 'Recursos')).rejects.toThrow(NEXT_ROUTER_MISSING)
  })
})

test.describe('solo lectura: catálogo, recursos, métodos de pago y tasas', () => {
  test('ve los datos sin acciones de escritura', async ({ page }) => {
    await signInAs(page, 'lectura')

    await goToSection(page, 'Catálogo')
    await expect(rowOf(page, 'Limpieza facial (ejemplo)')).toBeVisible()
    await expect(page.getByRole('button', { name: /Nuevo servicio|Editar|Desactivar|Reactivar/ })).toHaveCount(0)

    await goToSection(page, 'Métodos de pago')
    await expect(rowOf(page, 'Efectivo')).toBeVisible()
    await expect(page.getByRole('button', { name: /Nuevo método de pago|Editar|Desactivar|Reactivar/ })).toHaveCount(0)

    await navigateViaNextRouter(page, '/ajustes/recursos/', 'Recursos')
    await expect(rowOf(page, 'Cabina 1')).toBeVisible()
    await expect(page.getByRole('button', { name: /Nuevo recurso|Editar|Desactivar|Reactivar/ })).toHaveCount(0)

    await navigateViaNextRouter(page, '/ajustes/tasas/', 'Tasas de cambio')
    await expect(rowOf(page, FIXED_TODAY)).toBeVisible()
    await expect(page.getByText('Solo lectura: no tienes permiso para modificar las tasas.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar tasa' })).toHaveCount(0)
  })

  test('las mutaciones por IPC son denegadas y no alteran los datos', async ({ page }) => {
    await signInAs(page, 'lectura')
    const before = await snapshotData(page)
    const seededRate = before.rates.find((rate) => rate.date === FIXED_TODAY)
    expect(seededRate).toBeDefined()
    const denied = { resolved: false, payload: expect.objectContaining(FORBIDDEN_ERROR) }

    expect(
      await invokeCommand(page, 'create_service', { input: { name: 'Intruso', priceCents: 100, durationMin: 30 } }),
    ).toEqual(denied)
    expect(await invokeCommand(page, 'create_resource', { input: { name: 'Intruso', kind: 'cabin' } })).toEqual(denied)
    expect(await invokeCommand(page, 'create_payment_method', { input: { name: 'Intruso' } })).toEqual(denied)
    expect(await invokeCommand(page, 'upsert_rate', { date: FIXED_TODAY, rateBsPerUsdE4: 1_000_000 })).toEqual(denied)

    const after = await snapshotData(page)
    expect(after).toEqual(before)
    expect(after.resources.map((resource) => resource.name)).not.toContain('Intruso')
    expect(after.paymentMethods.map((method) => method.name)).not.toContain('Intruso')
    expect(after.rates.find((rate) => rate.date === FIXED_TODAY)).toEqual(seededRate)

    await goToSection(page, 'Catálogo')
    await expect(rowOf(page, 'Limpieza facial (ejemplo)')).toBeVisible()
    await expect(rowOf(page, 'Intruso')).toHaveCount(0)
  })
})
