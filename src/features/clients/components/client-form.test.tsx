import { mockIPC } from '@tauri-apps/api/mocks'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import type { Client } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { deferred } from '@/test/deferred'
import { renderWithProviders } from '@/test/render'
import { ClientForm } from './client-form'

const MARIA: Client = {
  id: 1,
  firstName: 'María',
  lastName: 'González',
  nationalId: 'V-12345678',
  phone: '0414-1234567',
  deletedAt: null,
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

async function fillForm(
  user: ReturnType<typeof renderWithProviders>['user'],
  values: { firstName: string; lastName: string; nationalId: string; phone: string },
) {
  await user.type(screen.getByLabelText('Nombre'), values.firstName)
  await user.type(screen.getByLabelText('Apellido'), values.lastName)
  await user.type(screen.getByLabelText('Cédula'), values.nationalId)
  await user.type(screen.getByLabelText('Teléfono'), values.phone)
}

const NEW_VALUES = { firstName: 'Valentina', lastName: 'Ríos', nationalId: 'V-30111222', phone: '0414-5550000' }

describe('ClientForm alta', () => {
  it('muestra los campos etiquetados vacíos', () => {
    renderWithProviders(<ClientForm onSaved={vi.fn()} />, { as: 'recepcion' })

    for (const label of ['Nombre', 'Apellido', 'Cédula', 'Teléfono']) {
      expect(screen.getByLabelText(label)).toHaveValue('')
    }
    expect(screen.getByRole('button', { name: 'Guardar cliente' })).toBeInTheDocument()
  })

  it('crea el cliente y notifica con el resultado', async () => {
    const onSaved = vi.fn()
    const { user } = renderWithProviders(<ClientForm onSaved={onSaved} />, { as: 'recepcion' })

    await fillForm(user, NEW_VALUES)
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledWith({ ...NEW_VALUES, id: 10, deletedAt: null })
    expect(getState().clients).toHaveLength(10)
  })

  it('valida campos vacíos sin escribir en el store', async () => {
    const onSaved = vi.fn()
    const { user } = renderWithProviders(<ClientForm onSaved={onSaved} />, { as: 'recepcion' })

    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    expect(await screen.findByText('Ingresa el nombre')).toBeInTheDocument()
    expect(screen.getByText('Ingresa el apellido')).toBeInTheDocument()
    expect(screen.getAllByText(/Cédula inválida/)).toHaveLength(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(getState().clients).toHaveLength(9)
  })

  it.each(['V--12-34-56-78', 'X-12345678', 'V-12345'])('rechaza la cédula inválida %j', async (nationalId) => {
    const { user } = renderWithProviders(<ClientForm onSaved={vi.fn()} />, { as: 'recepcion' })

    await fillForm(user, { ...NEW_VALUES, nationalId })
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    expect(await screen.findByText(/Cédula inválida/)).toBeInTheDocument()
    expect(screen.getByLabelText('Cédula')).toHaveAttribute('aria-invalid', 'true')
  })

  it.each([
    ['v-30111222', 'V-30111222'],
    [' V-30111222 ', 'V-30111222'],
    ['v30111222', 'V-30111222'],
    ['v 30111222', 'V-30111222'],
    ['V-30.111.222', 'V-30111222'],
  ])('normaliza la cédula %j a %j antes de enviarla a Rust', async (typed, sent) => {
    const calls: unknown[] = []
    mockIPC((cmd, args) => {
      calls.push({ cmd, args })
      return { id: 10, ...NEW_VALUES, nationalId: sent, deletedAt: null }
    })
    const onSaved = vi.fn()
    const { user } = renderWithProviders(<ClientForm onSaved={onSaved} />, { as: 'recepcion' })

    await fillForm(user, { ...NEW_VALUES, nationalId: typed })
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls.filter((call) => (call as { cmd: string }).cmd === 'create_client')).toEqual([
      { cmd: 'create_client', args: { input: { ...NEW_VALUES, nationalId: sent } } },
    ])
  })

  it('muestra nationalIdTaken en el campo cédula', async () => {
    const onSaved = vi.fn()
    const { user } = renderWithProviders(<ClientForm onSaved={onSaved} />, { as: 'recepcion' })

    await fillForm(user, { ...NEW_VALUES, nationalId: 'V-14567890' })
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    expect(await screen.findByText('Ya existe un cliente con esa cédula')).toBeInTheDocument()
    expect(screen.getByLabelText('Cédula')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('button', { name: 'Reactivar cliente' })).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('ofrece Reactivar cliente cuando la cédula es de un cliente eliminado y lo reactiva', async () => {
    const onSaved = vi.fn()
    const { user } = renderWithProviders(<ClientForm onSaved={onSaved} />, { as: 'recepcion' })
    const deleted = getState().clients.find((client) => client.deletedAt !== null) as Client

    await fillForm(user, { ...NEW_VALUES, nationalId: deleted.nationalId })
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))
    await user.click(await screen.findByRole('button', { name: 'Reactivar cliente' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledWith({ ...deleted, deletedAt: null })
    expect(getState().clients).toHaveLength(9)
    expect(getState().clients.find((client) => client.id === deleted.id)?.deletedAt).toBeNull()
  })

  it('muestra clientDeletedReactivate sin reactivar a ciegas: usa el id de entityIds de Rust', async () => {
    const calls: { cmd: string; args: unknown }[] = []
    mockIPC((cmd, args) => {
      calls.push({ cmd, args })
      if (cmd === 'create_client') {
        return Promise.reject({
          code: 'clientDeletedReactivate',
          message: 'Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo?',
          field: 'nationalId',
          entityIds: [77],
        })
      }
      return { id: 77, ...NEW_VALUES, deletedAt: null }
    })
    const onSaved = vi.fn()
    const { user } = renderWithProviders(<ClientForm onSaved={onSaved} />, { as: 'recepcion' })

    await fillForm(user, NEW_VALUES)
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))
    expect(await screen.findByText(/¿Reactivarlo\?/)).toBeInTheDocument()
    expect(screen.getByLabelText('Cédula')).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Reactivar cliente' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls.at(-1)).toEqual({ cmd: 'set_client_deleted', args: { deletion: { id: 77, deleted: false } } })
  })

  describe('reactivación accesible', () => {
    const REACTIVATE_ERROR = {
      code: 'clientDeletedReactivate',
      message: 'Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo?',
      field: 'nationalId',
      entityIds: [77],
    }

    async function reachReactivation(handler: (cmd: string) => unknown) {
      mockIPC((cmd) => (cmd === 'create_client' ? Promise.reject(REACTIVATE_ERROR) : handler(cmd)))
      const rendered = renderWithProviders(<ClientForm onSaved={vi.fn()} />, { as: 'recepcion' })
      await fillForm(rendered.user, NEW_VALUES)
      await rendered.user.click(screen.getByRole('button', { name: 'Guardar cliente' }))
      await screen.findByRole('button', { name: 'Reactivar cliente' })
      return rendered
    }

    it('anuncia el mensaje como alerta y lo asocia al botón con aria-describedby', async () => {
      await reachReactivation(() => null)

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('¿Reactivarlo?')
      expect(alert.id).not.toBe('')
      expect(screen.getByRole('button', { name: 'Reactivar cliente' })).toHaveAttribute('aria-describedby', alert.id)
      expect(screen.getAllByText(/¿Reactivarlo\?/)).toHaveLength(1)
    })

    it('al reactivar limpia los errores de campo y deshabilita el botón mientras corre', async () => {
      const pending = deferred<unknown>()
      const { user } = await reachReactivation(() => pending.promise)

      await user.click(screen.getByRole('button', { name: 'Reactivar cliente' }))

      expect(screen.getByLabelText('Cédula')).not.toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('button', { name: 'Reactivar cliente' })).toBeDisabled()
      pending.resolve({ id: 77, ...NEW_VALUES, deletedAt: null })
    })

    it('si la reactivación falla reemplaza el aviso por el nuevo error y retira el botón', async () => {
      const { user } = await reachReactivation(() =>
        Promise.reject({ code: 'forbidden', message: 'No tienes permiso para esta acción', field: null, entityIds: null }),
      )

      await user.click(screen.getByRole('button', { name: 'Reactivar cliente' }))

      expect(await screen.findByText('No tienes permiso para esta acción')).toBeInTheDocument()
      expect(screen.queryByText(/¿Reactivarlo\?/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reactivar cliente' })).not.toBeInTheDocument()
    })

    it('un doble clic dispara una sola mutación set_client_deleted', async () => {
      const pending = deferred<unknown>()
      const calls: string[] = []
      const { user } = await reachReactivation((cmd) => {
        calls.push(cmd)
        return pending.promise
      })

      const button = screen.getByRole('button', { name: 'Reactivar cliente' })
      await user.dblClick(button)
      pending.resolve({ id: 77, ...NEW_VALUES, deletedAt: null })

      await waitFor(() => expect(calls.filter((cmd) => cmd === 'set_client_deleted')).toHaveLength(1))
    })
  })

  it('muestra el error de permisos como alerta', async () => {
    const { user } = renderWithProviders(<ClientForm onSaved={vi.fn()} />, { as: 'lectura' })

    await fillForm(user, NEW_VALUES)
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
  })
})

describe('ClientForm edición', () => {
  it('precarga los valores del cliente', () => {
    renderWithProviders(<ClientForm client={MARIA} onSaved={vi.fn()} />, { as: 'recepcion' })

    expect(screen.getByLabelText('Nombre')).toHaveValue('María')
    expect(screen.getByLabelText('Apellido')).toHaveValue('González')
    expect(screen.getByLabelText('Cédula')).toHaveValue('V-12345678')
    expect(screen.getByLabelText('Teléfono')).toHaveValue('0414-1234567')
  })

  it('actualiza el cliente conservando su cédula', async () => {
    const onSaved = vi.fn()
    const { user } = renderWithProviders(<ClientForm client={MARIA} onSaved={onSaved} />, { as: 'recepcion' })

    await user.clear(screen.getByLabelText('Nombre'))
    await user.type(screen.getByLabelText('Nombre'), 'Mariela')
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(getState().clients.find((client) => client.id === 1)?.firstName).toBe('Mariela')
    expect(getState().clients).toHaveLength(9)
  })

  it('muestra notFound de Rust como alerta si el cliente editado ya no existe', async () => {
    const { user } = renderWithProviders(<ClientForm client={{ ...MARIA, id: 999 }} onSaved={vi.fn()} />, {
      as: 'recepcion',
    })

    await user.clear(screen.getByLabelText('Nombre'))
    await user.type(screen.getByLabelText('Nombre'), 'Mariela')
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Cliente no encontrado')
  })

  it('no ofrece reactivar al editar hacia la cédula de un cliente eliminado', async () => {
    const { user } = renderWithProviders(<ClientForm client={MARIA} onSaved={vi.fn()} />, { as: 'recepcion' })
    const deleted = getState().clients.find((client) => client.deletedAt !== null) as Client

    await user.clear(screen.getByLabelText('Cédula'))
    await user.type(screen.getByLabelText('Cédula'), deleted.nationalId)
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }))

    const message = await screen.findByText('Ya existe un cliente con esa cédula')
    expect(within(message.closest('form') as HTMLElement).queryByRole('button', { name: 'Reactivar cliente' })).toBeNull()
  })
})
