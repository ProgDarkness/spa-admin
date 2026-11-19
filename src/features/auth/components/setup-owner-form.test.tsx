import { screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { useSession } from '@/lib/session'
import { freezeDate } from '@/test/clock'
import { createAuthIpcBackend } from '@/test/ipc/auth-backend'
import { formatRecoveryCode } from '@/test/ipc/recovery-codes'
import { renderWithProviders } from '@/test/render'
import { SetupOwnerForm } from './setup-owner-form'

const PASSWORD = 'clave-larga-1'
const SAVED_LABEL = 'Guardé mi código de recuperación'

let calls: string[]

function installEmptyBackend(): void {
  commit({ ...getState(), users: [], sessionUserId: null })
  const backend = createAuthIpcBackend(
    () => getState().users,
    { read: () => getState().sessionUserId, write: (id) => commit({ ...getState(), sessionUserId: id }) },
    { directory: { add: (user) => commit({ ...getState(), users: [...getState().users, user] }) } },
  )
  mockIPC((cmd, args) => {
    calls.push(cmd)
    return backend(cmd, args)
  })
}

function StatusProbe() {
  return <p>{`estado:${useSession().status}`}</p>
}

function renderForm() {
  const onComplete = vi.fn()
  const rendered = renderWithProviders(
    <>
      <SetupOwnerForm onComplete={onComplete} />
      <StatusProbe />
    </>,
  )
  return { ...rendered, onComplete }
}

async function fillForm(user: ReturnType<typeof renderForm>['user'], overrides: Partial<Record<string, string>> = {}) {
  await user.type(screen.getByLabelText('Usuario'), overrides.username ?? 'dueña')
  await user.type(screen.getByLabelText('Contraseña'), overrides.password ?? PASSWORD)
  await user.type(screen.getByLabelText('Confirmar contraseña'), overrides.confirm ?? PASSWORD)
  await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  calls = []
  installEmptyBackend()
})

function installRealBuildBackend(): void {
  commit({ ...getState(), sessionUserId: null })
  const backend = createAuthIpcBackend(
    () => [],
    { read: () => getState().sessionUserId, write: (id) => commit({ ...getState(), sessionUserId: id }) },
  )
  mockIPC((cmd, args) => {
    calls.push(cmd)
    return backend(cmd, args)
  })
}

describe('SetupOwnerForm en build real sin la propietaria en el mock', () => {
  it('primer arranque sin directory: la sesión de Rust se conserva y el mock apunta al usuario creado', async () => {
    installRealBuildBackend()
    const { user } = renderForm()

    await fillForm(user, { username: 'dueña-real' })

    expect(await screen.findByText(formatRecoveryCode(0))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('estado:signedIn')).toBeInTheDocument())
    const stored = getState().users.find((candidate) => candidate.username === 'dueña-real')
    expect(stored?.roleName).toBe('Propietaria')
    expect(getState().sessionUserId).toBe(stored?.id)
    expect(calls).not.toContain('logout')
  })
})

describe('SetupOwnerForm', () => {
  it('muestra campos etiquetados con autocompletado de contraseña nueva', () => {
    renderForm()

    expect(screen.getByLabelText('Usuario')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Confirmar contraseña')).toHaveAttribute('type', 'password')
  })

  it('setup_password_min_10_error_text', async () => {
    const { user } = renderForm()

    await fillForm(user, { password: 'corta', confirm: 'corta' })

    expect(await screen.findByText('La contraseña debe tener al menos 10 caracteres')).toBeInTheDocument()
    expect(calls).not.toContain('setup_owner')
  })

  it('exige confirmación igual sin llamar al backend', async () => {
    const { user } = renderForm()

    await fillForm(user, { confirm: 'otra-clave-larga' })

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(calls).not.toContain('setup_owner')
  })

  it('muestra el texto por campo cuando el backend devuelve validation password', async () => {
    const { user } = renderForm()
    mockIPC((cmd) => {
      if (cmd === 'setup_owner') {
        throw { code: 'validation', message: 'Revisa el dato ingresado', field: 'password', entityIds: null }
      }
      return null
    })

    await fillForm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña debe tener al menos 10 caracteres')
  })

  it('muestra forbidden cuando el primer arranque ya se completó', async () => {
    const { user } = renderForm()
    mockIPC((cmd) => {
      if (cmd === 'setup_owner') {
        throw { code: 'forbidden', message: 'No tienes permiso para esta acción', field: null, entityIds: null }
      }
      return null
    })

    await fillForm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para esta acción')
  })

  it('tras crear la cuenta muestra el código y la sesión queda iniciada', async () => {
    const { user } = renderForm()

    await fillForm(user)

    expect(await screen.findByText(formatRecoveryCode(0))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('estado:signedIn')).toBeInTheDocument())
    expect(screen.queryByLabelText('Usuario')).not.toBeInTheDocument()
  })

  it('recovery_code_shown_once_and_cleared_from_state', async () => {
    const { user, onComplete } = renderForm()
    await fillForm(user)
    await screen.findByText(formatRecoveryCode(0))

    await user.click(screen.getByRole('checkbox', { name: SAVED_LABEL }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.queryByText(formatRecoveryCode(0))).not.toBeInTheDocument()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('no permite continuar sin marcar la casilla', async () => {
    const { user, onComplete } = renderForm()
    await fillForm(user)
    await screen.findByText(formatRecoveryCode(0))

    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(onComplete).not.toHaveBeenCalled()
  })
})
