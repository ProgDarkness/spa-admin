import { expect, test } from '@playwright/test'
import { appointmentCard, fillAppointmentForm, newAppointmentDialog, submitAppointment } from './support/appointments'
import { fillClientForm, openNewClientDialog } from './support/clients'
import { paymentsDialog, registerPayment } from './support/payments'
import { FIXED_TODAY, goToSection, mainNavigation, openLogin, signInAs } from './support/session'

const NEW_CLIENT = { firstName: 'Valeria', lastName: 'Prueba', nationalId: 'V-30111222', phone: '0414-5550000' }
const NEW_CLIENT_NAME = 'Valeria Prueba'
const FACIAL = 'Limpieza facial (ejemplo)'
const INVALID_NATIONAL_ID_MESSAGE = 'Cédula inválida. Formato: V-12345678'
const OVERLAP_MESSAGE = 'El recurso ya tiene una cita en ese horario'
const CROSSES_MIDNIGHT_MESSAGE = 'La cita no puede terminar después de la medianoche'

test.describe('propietaria: flujo completo', () => {
  test('cliente, cita, solape, atención, pago mixto, ficha y métricas', async ({ page }) => {
    await signInAs(page, 'propietaria')

    await goToSection(page, 'Clientes')
    const clientDialog = await openNewClientDialog(page)

    await fillClientForm(page, { ...NEW_CLIENT, nationalId: '' })
    await clientDialog.getByRole('button', { name: 'Guardar cliente' }).click()
    await expect(clientDialog.getByText(INVALID_NATIONAL_ID_MESSAGE)).toBeVisible()

    await fillClientForm(page, { ...NEW_CLIENT, nationalId: '12345678' })
    await clientDialog.getByRole('button', { name: 'Guardar cliente' }).click()
    await expect(clientDialog.getByText(INVALID_NATIONAL_ID_MESSAGE)).toBeVisible()

    await fillClientForm(page, NEW_CLIENT)
    await clientDialog.getByRole('button', { name: 'Guardar cliente' }).click()
    await expect(clientDialog).toBeHidden()
    await expect(page.getByRole('link', { name: NEW_CLIENT_NAME })).toBeVisible()
    await expect(page.getByRole('cell', { name: NEW_CLIENT.nationalId })).toBeVisible()

    await goToSection(page, 'Citas')
    await page.getByRole('button', { name: 'Crear cita en Cabina 1 a las 10:00' }).click()
    const creation = newAppointmentDialog(page)
    await creation.getByLabel('Cliente').selectOption({ label: NEW_CLIENT_NAME })
    await creation.getByLabel('Servicio').selectOption({ label: FACIAL })
    await creation.getByRole('button', { name: 'Crear cita' }).click()
    await expect(creation).toBeHidden()
    const card = appointmentCard(page, NEW_CLIENT_NAME, '10:00')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Programada')

    await page.getByRole('button', { name: 'Nueva cita' }).click()
    const overlapping = await submitAppointment(page, {
      client: 'José Rodríguez',
      service: FACIAL,
      resource: 'Cabina 1',
      startsAt: `${FIXED_TODAY}T10:30`,
    })
    await expect(overlapping.getByText(OVERLAP_MESSAGE)).toBeVisible()
    await expect(overlapping.getByText(/Citas en conflicto: #\d+/)).toBeVisible()
    await overlapping.getByRole('button', { name: 'Cancelar' }).click()
    await expect(overlapping).toBeHidden()
    await expect(page.getByRole('article', { name: /Cita de José Rodríguez a las 10:30/ })).toHaveCount(0)

    await card.getByRole('button', { name: `Iniciar cita de ${NEW_CLIENT_NAME}` }).click()
    await expect(card).toContainText('En curso')
    await card.getByRole('button', { name: `Completar cita de ${NEW_CLIENT_NAME}` }).click()
    await expect(card).toContainText('Completada')

    await card.getByRole('button', { name: 'Pagos' }).click()
    const payments = paymentsDialog(page)
    await expect(payments).toBeVisible()
    await registerPayment(page, { method: 'Efectivo', currency: 'Dólares (USD)', amount: '20,00' })
    await payments.getByLabel('Moneda').selectOption({ label: 'Bolívares (VES)' })
    await expect(payments.getByLabel('Tasa (Bs por USD)')).toHaveValue('36,50')
    await registerPayment(page, { method: 'Pago móvil', currency: 'Bolívares (VES)', amount: '547,50' })
    const totals = payments.getByRole('group', { name: 'Totales cobrados' })
    await expect(totals).toContainText(/Total USD:.*20,00/)
    await expect(totals).toContainText(/Total VES:.*547,50/)
    await expect(totals).toContainText(/Total equivalente en USD:.*35,00/)
    await page.keyboard.press('Escape')
    await expect(payments).toBeHidden()

    await goToSection(page, 'Clientes')
    await page.getByRole('link', { name: NEW_CLIENT_NAME }).click()
    await expect(page.getByRole('heading', { level: 1, name: NEW_CLIENT_NAME })).toBeVisible()
    const summary = page.getByRole('region', { name: 'Resumen' })
    await expect(summary).toContainText(/Pagado en USD:.*20,00/)
    await expect(summary).toContainText(/Pagado en VES:.*547,50/)
    await expect(summary).toContainText(/Equivalente en USD de pagos en VES:.*15,00/)
    await expect(summary).toContainText('Tiempo total en servicios completados: 1 h')

    await goToSection(page, 'Métricas')
    const revenue = page.getByRole('region', { name: 'Ingreso del mes' })
    await expect(revenue).toContainText(/100,00/)
    await expect(revenue).toContainText(/1\.277,50/)
  })
})

test.describe('recepción', () => {
  test('no ve Métricas ni controles de edición del catálogo', async ({ page }) => {
    await signInAs(page, 'recepcion')

    const navigation = mainNavigation(page)
    await expect(navigation.getByRole('link', { name: 'Citas' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Catálogo' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Métricas' })).toHaveCount(0)
    await expect(navigation.getByRole('link', { name: 'Recursos' })).toHaveCount(0)

    await goToSection(page, 'Catálogo')
    await expect(page.getByRole('cell', { name: FACIAL })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nuevo servicio' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Editar/ })).toHaveCount(0)
  })
})

test.describe('solo lectura', () => {
  test('ve agenda y catálogo sin controles de creación ni edición', async ({ page }) => {
    await signInAs(page, 'lectura')

    await expect(page.getByRole('button', { name: 'Nueva cita' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Crear cita en/ })).toHaveCount(0)
    await expect(page.getByRole('article', { name: /Cita de Sofía Ramírez a las 16:00/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Iniciar|Completar|Mover/ })).toHaveCount(0)

    await goToSection(page, 'Catálogo')
    await expect(page.getByRole('cell', { name: FACIAL })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nuevo servicio' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Editar|Desactivar|Activar/ })).toHaveCount(0)

    await goToSection(page, 'Clientes')
    await expect(page.getByRole('button', { name: 'Nuevo cliente' })).toHaveCount(0)
    await expect(mainNavigation(page).getByRole('link', { name: 'Métricas' })).toHaveCount(0)
  })
})

test.describe('persistencia', () => {
  test('recargar descarta los cambios y vuelve al login (D21)', async ({ page }) => {
    await signInAs(page, 'propietaria')
    await goToSection(page, 'Clientes')
    const dialog = await openNewClientDialog(page)
    await fillClientForm(page, NEW_CLIENT)
    await dialog.getByRole('button', { name: 'Guardar cliente' }).click()
    await expect(page.getByRole('link', { name: NEW_CLIENT_NAME })).toBeVisible()

    await page.reload()
    await expect(page).toHaveURL(/\/login\/?$/)
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()

    await page.getByLabel('Usuario').fill('propietaria')
    await page.getByLabel('Contraseña').fill('demo1234')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await goToSection(page, 'Clientes')
    await expect(page.getByRole('link', { name: 'María González' })).toBeVisible()
    await expect(page.getByRole('link', { name: NEW_CLIENT_NAME })).toHaveCount(0)
  })

  test('credenciales inválidas muestran error y no abren sesión', async ({ page }) => {
    await openLogin(page)
    await page.getByLabel('Usuario').fill('propietaria')
    await page.getByLabel('Contraseña').fill('incorrecta')
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Usuario o contraseña incorrectos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
  })
})

test.describe('medianoche', () => {
  test('acepta la cita que termina a las 00:00 y rechaza la que la cruza', async ({ page }) => {
    await signInAs(page, 'propietaria')

    await page.getByRole('button', { name: 'Nueva cita' }).click()
    const accepted = await submitAppointment(page, {
      client: 'María González',
      service: FACIAL,
      resource: 'Cabina 1',
      startsAt: `${FIXED_TODAY}T23:00`,
    })
    await expect(accepted).toBeHidden()
    await expect(appointmentCard(page, 'María González', '23:00')).toBeVisible()

    await page.getByRole('button', { name: 'Nueva cita' }).click()
    const rejected = await fillAppointmentForm(page, {
      client: 'José Rodríguez',
      service: FACIAL,
      resource: 'Cabina 2',
      startsAt: `${FIXED_TODAY}T23:30`,
    })
    await rejected.getByRole('button', { name: 'Crear cita' }).click()
    await expect(rejected.getByText(CROSSES_MIDNIGHT_MESSAGE)).toBeVisible()
    await expect(appointmentCard(page, 'José Rodríguez', '23:30')).toHaveCount(0)
  })
})
