import { expect, test, type Page } from '@playwright/test'
import { appointmentCard, newAppointmentDialog } from './support/appointments'
import { clientRow, saveNewClient, searchClients, type ClientDraft } from './support/clients'
import { goToSection, signInAs } from './support/session'

const ANGELA: ClientDraft = { firstName: 'Ángela', lastName: 'Sánchez', nationalId: 'V-31222333', phone: '0412-5551234' }
const ANGELA_NAME = 'Ángela Sánchez'
const DUPLICATE_MESSAGE = 'Ya existe un cliente con esa cédula'
const REACTIVATE_MESSAGE = 'Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo?'
const FORBIDDEN_ERROR = { code: 'forbidden', message: 'No tienes permiso para esta acción' }
const FACIAL = 'Limpieza facial (ejemplo)'

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

async function allClients(page: Page): Promise<unknown[]> {
  const outcome = (await invokeCommand(page, 'list_clients', { filter: { includeDeleted: true } })) as {
    resolved: boolean
    value: unknown[]
  }
  expect(outcome.resolved).toBe(true)
  return outcome.value
}

test.describe('propietaria: clientes', () => {
  test('alta de cliente y búsqueda por nombre con tilde, cédula en varias formas y teléfono', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Clientes')

    const dialog = await saveNewClient(page, ANGELA)
    await expect(dialog).toBeHidden()
    const created = clientRow(page, ANGELA_NAME)
    await expect(created).toContainText('V-31222333')
    await expect(created).toContainText('0412-5551234')

    for (const query of ['ángela', 'angela', 'SANCHEZ']) {
      await searchClients(page, query)
      await expect(page.getByRole('row')).toHaveCount(2)
      await expect(clientRow(page, ANGELA_NAME)).toBeVisible()
    }

    for (const query of ['V-31222333', 'v31222333', '31.222.333', 'V-31.222.333']) {
      await searchClients(page, query)
      await expect(page.getByRole('row')).toHaveCount(2)
      await expect(clientRow(page, ANGELA_NAME)).toContainText('V-31222333')
    }

    for (const query of ['0412-5551234', '04125551234']) {
      await searchClients(page, query)
      await expect(page.getByRole('row')).toHaveCount(2)
      await expect(clientRow(page, ANGELA_NAME)).toContainText('0412-5551234')
    }

    await searchClients(page, 'maria')
    await expect(page.getByRole('row')).toHaveCount(2)
    await expect(clientRow(page, 'María González')).toBeVisible()

    await searchClients(page, 'zzz-inexistente')
    await expect(page.getByText('No se encontraron clientes')).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(0)
  })

  test('una cédula duplicada se rechaza en el campo y no crea el cliente', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Clientes')

    const dialog = await saveNewClient(page, { ...ANGELA, nationalId: 'v12345678' })

    await expect(dialog.getByText(DUPLICATE_MESSAGE)).toBeVisible()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(clientRow(page, ANGELA_NAME)).toHaveCount(0)
    await expect(clientRow(page, 'V-12345678')).toHaveCount(1)
  })

  test('la cédula de un cliente borrado ofrece reactivar y lo reactiva', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Clientes')
    await expect(clientRow(page, 'Carlos Mendoza')).toHaveCount(0)

    const dialog = await saveNewClient(page, { ...ANGELA, nationalId: 'V-26789012' })
    await expect(dialog.getByRole('alert').filter({ hasText: REACTIVATE_MESSAGE })).toBeVisible()
    await dialog.getByRole('button', { name: 'Reactivar cliente' }).click()

    await expect(dialog).toBeHidden()
    const reactivated = clientRow(page, 'Carlos Mendoza')
    await expect(reactivated).toContainText('V-26789012')
    await expect(reactivated).toContainText('0416-9012345')
    await expect(reactivated).not.toContainText('Eliminado')
    await expect(clientRow(page, ANGELA_NAME)).toHaveCount(0)
  })

  test('edita un cliente y el cambio se ve en la lista', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Clientes')

    await page.getByRole('button', { name: 'Editar María González' }).click()
    const dialog = page.getByRole('dialog', { name: 'Editar cliente' })
    await expect(dialog.getByLabel('Nombre')).toHaveValue('María')
    await expect(dialog.getByLabel('Cédula')).toHaveValue('V-12345678')
    await dialog.getByLabel('Apellido').fill('Gómez')
    await dialog.getByLabel('Teléfono').fill('0414-7770000')
    await dialog.getByRole('button', { name: 'Guardar cliente' }).click()

    await expect(dialog).toBeHidden()
    const edited = clientRow(page, 'María Gómez')
    await expect(edited).toContainText('V-12345678')
    await expect(edited).toContainText('0414-7770000')
    await expect(clientRow(page, 'María González')).toHaveCount(0)
  })

  test('elimina con confirmación, se oculta y reaparece al mostrar eliminados para reactivarlo', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Clientes')

    await page.getByRole('button', { name: 'Eliminar Ana Pérez' }).click()
    const confirmation = page.getByRole('dialog', { name: '¿Eliminar a Ana Pérez?' })
    await confirmation.getByRole('button', { name: 'Cancelar' }).click()
    await expect(clientRow(page, 'Ana Pérez')).toBeVisible()

    await page.getByRole('button', { name: 'Eliminar Ana Pérez' }).click()
    await confirmation.getByRole('button', { name: 'Eliminar' }).click()
    await expect(confirmation).toBeHidden()
    await expect(clientRow(page, 'Ana Pérez')).toHaveCount(0)

    await page.getByLabel('Mostrar eliminados').check()
    const deleted = clientRow(page, 'Ana Pérez')
    await expect(deleted).toContainText('Eliminado')
    await expect(deleted.getByRole('button', { name: 'Editar Ana Pérez' })).toHaveCount(0)

    await deleted.getByRole('button', { name: 'Reactivar Ana Pérez' }).click()
    await expect(clientRow(page, 'Ana Pérez')).not.toContainText('Eliminado')
    await page.getByLabel('Mostrar eliminados').uncheck()
    await expect(clientRow(page, 'Ana Pérez')).toContainText('V-16789012')
  })

  test('crea una cita con un cliente recién creado', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Clientes')
    const dialog = await saveNewClient(page, ANGELA)
    await expect(dialog).toBeHidden()

    await goToSection(page, 'Citas')
    await page.getByRole('button', { name: 'Crear cita en Cabina 1 a las 10:00' }).click()
    const creation = newAppointmentDialog(page)
    await creation.getByLabel('Cliente').selectOption({ label: ANGELA_NAME })
    await creation.getByLabel('Servicio').selectOption({ label: FACIAL })
    await creation.getByRole('button', { name: 'Crear cita' }).click()

    await expect(creation).toBeHidden()
    const card = appointmentCard(page, ANGELA_NAME, '10:00')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Programada')
    await expect(card).toContainText('10:00 – 11:00')
    await expect(card).toContainText(FACIAL)
  })

  test('la ficha del cliente del seed muestra datos e historial real', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Clientes')

    await page.getByRole('link', { name: 'María González' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'María González' })).toBeVisible()
    await expect(page.getByText('V-12345678')).toBeVisible()
    await expect(page.getByText('0414-1234567')).toBeVisible()

    const timeline = page.getByRole('list', { name: 'Historial de citas' })
    await expect(timeline.getByRole('listitem')).toHaveCount(3)
    await expect(timeline.getByRole('listitem').filter({ hasText: FACIAL })).toContainText('Completada')
    await expect(timeline.getByRole('listitem').filter({ hasText: 'Masaje relajante (ejemplo)' })).toContainText(
      'Completada',
    )
    await expect(timeline.getByRole('listitem').filter({ hasText: 'Diseño de cejas (ejemplo)' })).toContainText(
      'Programada',
    )
    await expect(page.getByRole('region', { name: 'Resumen' })).toContainText('Tiempo total en servicios completados')
  })
})

test.describe('solo lectura: clientes', () => {
  test('ve la lista sin controles de escritura', async ({ page }) => {
    await signInAs(page, 'lectura')
    await goToSection(page, 'Clientes')

    await expect(clientRow(page, 'María González')).toContainText('V-12345678')
    await expect(page.getByRole('button', { name: /Nuevo cliente|Editar|Eliminar|Reactivar/ })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Acciones' })).toHaveCount(0)
  })

  test('las mutaciones por IPC son denegadas y no alteran los datos', async ({ page }) => {
    await signInAs(page, 'lectura')
    const before = await allClients(page)
    const denied = { resolved: false, payload: expect.objectContaining(FORBIDDEN_ERROR) }

    expect(
      await invokeCommand(page, 'create_client', {
        input: { firstName: 'Intruso', lastName: 'Falso', nationalId: 'V-30999888', phone: '0414-1112233' },
      }),
    ).toEqual(denied)
    expect(
      await invokeCommand(page, 'update_client', {
        update: { id: 1, firstName: 'Intruso', lastName: 'Falso', nationalId: 'V-12345678', phone: '0414-1234567' },
      }),
    ).toEqual(denied)
    expect(await invokeCommand(page, 'set_client_deleted', { deletion: { id: 1, deleted: true } })).toEqual(denied)

    const after = await allClients(page)
    expect(after).toEqual(before)
    expect(JSON.stringify(after)).not.toContain('Intruso')

    await goToSection(page, 'Clientes')
    await expect(clientRow(page, 'María González')).toBeVisible()
    await expect(clientRow(page, 'Intruso')).toHaveCount(0)
  })
})
