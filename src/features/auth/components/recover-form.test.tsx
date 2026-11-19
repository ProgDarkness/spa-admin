import { screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { createAuthIpcBackend } from '@/test/ipc/auth-backend'
import { canonicalRecoveryCode, formatRecoveryCode } from '@/test/ipc/recovery-codes'
import { renderWithProviders } from '@/test/render'
import { RecoverForm } from './recover-form'

const NEW_PASSWORD = 'nueva-clave-larga'
const SAVED_LABEL = 'Guardé mi código de recuperación'

let calls: string[]

function installRecoverableBackend(): void {
  const backend = createAuthIpcBackend(
    () => getState().users,
    { read: () => getState().sessionUserId, write: (id) => commit({ ...getState(), sessionUserId: id }) },
    { recoverableUsernames: ['propietaria'] },
  )
  mockIPC((cmd, args) => {
    calls.push(cmd)
    return backend(cmd, args)
  })
}

function renderForm() {
  const onComplete = vi.fn()
  const rendered = renderWithProviders(<RecoverForm onComplete={onComplete} />)
  return { ...rendered, onComplete }
}

async function fillForm(user: ReturnType<typeof renderForm>['user'], overrides: Partial<Record<string, string>> = {}) {
  await user.type(screen.getByLabelText('Usuario'), overrides.username ?? 'propietaria')
  await user.type(screen.getByLabelText('Código de recuperación'), overrides.code ?? formatRecoveryCode(0))
  await user.type(screen.getByLabelText('Nueva contraseña'), overrides.password ?? NEW_PASSWORD)
  await user.type(screen.getByLabelText('Confirmar nueva contraseña'), overrides.confirm ?? NEW_PASSWORD)
  await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  calls = []
  installRecoverableBackend()
})

describe('RecoverForm', () => {
  it('muestra los campos etiquetados', () => {
    renderForm()

    expect(screen.getByLabelText('Usuario')).toBeInTheDocument()
    expect(screen.getByLabelText('Código de recuperación')).toBeInTheDocument()
    expect(screen.getByLabelText('Nueva contraseña')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Confirmar nueva contraseña')).toBeInTheDocument()
  })

  it('recover_code_field_disables_spellcheck_and_autocorrect_and_capitalizes', () => {
    renderForm()

    const field = screen.getByLabelText('Código de recuperación')
    expect(field).toHaveAttribute('spellcheck', 'false')
    expect(field).toHaveAttribute('autocapitalize', 'characters')
    expect(field).toHaveAttribute('autocorrect', 'off')
    expect(screen.getByLabelText('Usuario')).not.toHaveAttribute('spellcheck')
  })

  it('valida el código de 20 caracteres y la contraseña antes de llamar al backend', async () => {
    const { user } = renderForm()

    await fillForm(user, { code: 'ABCD-EFGH', password: 'corta', confirm: 'otra' })

    expect(await screen.findByText('El código de recuperación tiene 20 caracteres')).toBeInTheDocument()
    expect(screen.getByText('La contraseña debe tener al menos 10 caracteres')).toBeInTheDocument()
    expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(calls).not.toContain('recover_password')
  })

  it('envía el código normalizado a 20 caracteres', async () => {
    const received: unknown[] = []
    const { user } = renderForm()
    mockIPC((cmd, args) => {
      received.push(args)
      return cmd === 'recover_password' ? { recoveryCode: formatRecoveryCode(1) } : null
    })

    await fillForm(user, { code: formatRecoveryCode(0).toLowerCase() })
    await screen.findByText(formatRecoveryCode(1))

    expect(received).toEqual([
      { input: { username: 'propietaria', recoveryCode: canonicalRecoveryCode(0), newPassword: NEW_PASSWORD } },
    ])
  })

  it('un código incorrecto muestra el mensaje de credenciales inválidas', async () => {
    const { user } = renderForm()

    await fillForm(user, { code: formatRecoveryCode(7) })

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos')
  })

  it('recover_form_shows_new_code_then_goes_to_login', async () => {
    const { user, onComplete } = renderForm()

    await fillForm(user)

    expect(await screen.findByText(formatRecoveryCode(1))).toBeInTheDocument()
    expect(screen.queryByLabelText('Código de recuperación')).not.toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('checkbox', { name: SAVED_LABEL }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.queryByText(formatRecoveryCode(1))).not.toBeInTheDocument()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('no inicia sesión tras recuperar', async () => {
    const { user } = renderForm()

    await fillForm(user)
    await screen.findByText(formatRecoveryCode(1))

    expect(getState().sessionUserId).toBeNull()
  })
})
