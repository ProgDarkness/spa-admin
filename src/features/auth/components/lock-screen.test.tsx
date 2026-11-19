import { screen, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { beforeEach, describe, expect, it } from 'vitest'
import { commands } from '@/lib/bindings'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { useSession } from '@/lib/session'
import { freezeDate } from '@/test/clock'
import { createAuthIpcBackend, DEV_PASSWORD, IDLE_LOCK_MS } from '@/test/ipc/auth-backend'
import { renderWithProviders } from '@/test/render'
import { LockScreen } from './lock-screen'

let nowMs: number
let calls: string[]

async function installLockedBackend(): Promise<void> {
  const backend = createAuthIpcBackend(
    () => getState().users,
    { read: () => getState().sessionUserId, write: (id) => commit({ ...getState(), sessionUserId: id }) },
    { now: () => nowMs },
  )
  mockIPC((cmd, args) => {
    calls.push(cmd)
    return backend(cmd, args)
  })
  await commands.login({ username: 'recepcion', password: DEV_PASSWORD })
  nowMs += IDLE_LOCK_MS
  await commands.currentSession()
  calls = []
}

function StatusProbe() {
  const { status, user } = useSession()
  return <p>{`estado:${status}:${user?.username ?? 'nadie'}`}</p>
}

function renderLockScreen() {
  return renderWithProviders(
    <>
      <LockScreen />
      <StatusProbe />
    </>,
  )
}

beforeEach(async () => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  nowMs = Date.UTC(2026, 10, 12, 13, 0, 0)
  calls = []
  await installLockedBackend()
})

describe('LockScreen', () => {
  it('muestra el aviso de bloqueo sin revelar el nombre de usuario', async () => {
    renderLockScreen()
    await screen.findByText('estado:locked:nadie')

    expect(screen.getByRole('heading', { level: 1, name: 'Sesión bloqueada' })).toBeInTheDocument()
    expect(screen.queryByText(/recepcion/)).not.toBeInTheDocument()
  })

  it('enfoca el campo de contraseña al aparecer y lo etiqueta', async () => {
    renderLockScreen()

    const field = await screen.findByLabelText('Contraseña')

    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'current-password')
    await waitFor(() => expect(field).toHaveFocus())
  })

  it('lock_screen_describes_the_password_field_with_the_explanation', async () => {
    renderLockScreen()

    const field = await screen.findByLabelText('Contraseña')

    expect(field).toHaveAccessibleDescription(/Por inactividad, la sesión se bloqueó/)
  })

  it('lock_screen_announces_the_lock_when_it_appears', async () => {
    renderLockScreen()

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sesión bloqueada por inactividad'))
  })

  it('conserva la descripción y suma el mensaje de error al campo inválido', async () => {
    const { user } = renderLockScreen()

    await user.click(await screen.findByRole('button', { name: 'Desbloquear' }))

    const field = screen.getByLabelText('Contraseña')
    expect(field).toBeInvalid()
    expect(field).toHaveAccessibleDescription(/Por inactividad.*Ingresa tu contraseña/)
  })

  it('lock_screen_unlock_with_active_session_does_not_claim_a_short_password', async () => {
    mockIPC((cmd) => {
      if (cmd === 'current_session') return { status: 'locked', user: null }
      if (cmd === 'unlock') throw { code: 'validation', message: 'Datos inválidos', field: 'password', entityIds: null }
      return null
    })
    const { user } = renderLockScreen()
    await screen.findByText('estado:locked:nadie')

    await user.type(screen.getByLabelText('Contraseña'), DEV_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Desbloquear' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('La sesión ya no está bloqueada')
    expect(alert).not.toHaveTextContent('10 caracteres')
  })

  it('lock_screen_unlock_restores_session', async () => {
    const { user } = renderLockScreen()
    await screen.findByText('estado:locked:nadie')

    await user.type(screen.getByLabelText('Contraseña'), DEV_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Desbloquear' }))

    expect(await screen.findByText('estado:signedIn:recepcion')).toBeInTheDocument()
    expect(calls).toContain('unlock')
  })

  it('lock_screen_wrong_password_shows_error', async () => {
    const { user } = renderLockScreen()
    await screen.findByText('estado:locked:nadie')

    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta')
    await user.click(screen.getByRole('button', { name: 'Desbloquear' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos')
    expect(screen.getByText('estado:locked:nadie')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toHaveValue('')
  })

  it('no llama a unlock con la contraseña vacía y avisa en español', async () => {
    const { user } = renderLockScreen()
    await screen.findByText('estado:locked:nadie')

    await user.click(screen.getByRole('button', { name: 'Desbloquear' }))

    expect(await screen.findByText('Ingresa tu contraseña')).toBeInTheDocument()
    expect(calls).not.toContain('unlock')
  })

  it('lock_screen_switch_user_signs_out', async () => {
    const { user } = renderLockScreen()
    await screen.findByText('estado:locked:nadie')

    await user.click(screen.getByRole('button', { name: 'Cambiar de usuario' }))

    expect(await screen.findByText('estado:signedOut:nadie')).toBeInTheDocument()
    expect(calls).toContain('logout')
  })

  it('muestra el error si cambiar de usuario falla', async () => {
    const { user } = renderLockScreen()
    await screen.findByText('estado:locked:nadie')
    mockIPC((cmd) => {
      if (cmd === 'logout') throw new Error('pánico')
      return null
    })

    await user.click(screen.getByRole('button', { name: 'Cambiar de usuario' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la operación')
  })
})
