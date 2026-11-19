import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { getState, resetStore } from '@/lib/mock/store'
import { useSession } from '@/lib/session'
import { freezeDate } from '@/test/clock'
import { renderWithProviders } from '@/test/render'
import { LoginForm } from './login-form'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

function StatusProbe() {
  return <p>{`estado:${useSession().status}`}</p>
}

function renderForm() {
  return renderWithProviders(
    <>
      <LoginForm />
      <StatusProbe />
    </>,
  )
}

describe('LoginForm', () => {
  it('muestra campos etiquetados y el botón de envío', () => {
    renderForm()

    expect(screen.getByLabelText('Usuario')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeInTheDocument()
  })

  it('valida campos vacíos sin llamar al api', async () => {
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('Ingresa tu usuario')).toBeInTheDocument()
    expect(screen.getByText('Ingresa tu contraseña')).toBeInTheDocument()
    expect(getState().sessionUserId).toBeNull()
  })

  it('muestra el mensaje visible de invalidCredentials con clave errónea', async () => {
    const { user } = renderForm()
    await user.type(screen.getByLabelText('Usuario'), 'propietaria')
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta')

    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos')
    expect(getState().sessionUserId).toBeNull()
  })

  it('muestra el mismo mensaje con un usuario inexistente', async () => {
    const { user } = renderForm()
    await user.type(screen.getByLabelText('Usuario'), 'fantasma')
    await user.type(screen.getByLabelText('Contraseña'), DEV_PASSWORD)

    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos')
  })

  it('abre sesión con credenciales válidas y limpia el error previo', async () => {
    const { user } = renderForm()
    await user.type(screen.getByLabelText('Usuario'), 'propietaria')
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))
    await screen.findByRole('alert')

    await user.clear(screen.getByLabelText('Contraseña'))
    await user.type(screen.getByLabelText('Contraseña'), DEV_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(screen.getByText('estado:signedIn')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(getState().sessionUserId).toBe(1)
  })

  it('recorta espacios del usuario al enviar', async () => {
    const { user } = renderForm()
    await user.type(screen.getByLabelText('Usuario'), '  recepcion  ')
    await user.type(screen.getByLabelText('Contraseña'), DEV_PASSWORD)

    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(getState().sessionUserId).toBe(2))
  })
})
