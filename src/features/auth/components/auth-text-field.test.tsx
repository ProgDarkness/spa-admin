import { zodResolver } from '@hookform/resolvers/zod'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Form } from '@/components/ui/form'
import { AuthTextField } from './auth-text-field'

const schema = z.object({ secret: z.string().min(3, 'Muy corta') })
type Values = z.infer<typeof schema>

type HarnessProps = Partial<
  Pick<ComponentProps<typeof AuthTextField<Values>>, 'type' | 'describedBy' | 'spellCheck' | 'autoCapitalize' | 'autoCorrect'>
>

function Harness({ type, ...inputHints }: HarnessProps) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { secret: '' } })
  return (
    <Form {...form}>
      <p id="ayuda">Texto de ayuda</p>
      <form onSubmit={form.handleSubmit(() => {})} noValidate>
        <AuthTextField
          control={form.control}
          name="secret"
          label="Secreto"
          type={type}
          autoComplete="new-password"
          {...inputHints}
        />
        <button type="submit">enviar</button>
      </form>
    </Form>
  )
}

describe('AuthTextField', () => {
  it('asocia la etiqueta al campo y aplica tipo y autocompletado', () => {
    render(<Harness type="password" />)

    const field = screen.getByLabelText('Secreto')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'new-password')
  })

  it('traslada spellCheck, autoCapitalize y autoCorrect al input', () => {
    render(<Harness spellCheck={false} autoCapitalize="characters" autoCorrect="off" />)

    const field = screen.getByLabelText('Secreto')
    expect(field).toHaveAttribute('spellcheck', 'false')
    expect(field).toHaveAttribute('autocapitalize', 'characters')
    expect(field).toHaveAttribute('autocorrect', 'off')
  })

  it('no fija atributos de corrección cuando no se piden', () => {
    render(<Harness />)

    const field = screen.getByLabelText('Secreto')
    expect(field).not.toHaveAttribute('spellcheck')
    expect(field).not.toHaveAttribute('autocapitalize')
    expect(field).not.toHaveAttribute('autocorrect')
  })

  it('describedBy se suma al mensaje de error en la descripción accesible', async () => {
    render(<Harness describedBy="ayuda" />)
    expect(screen.getByLabelText('Secreto')).toHaveAccessibleDescription('Texto de ayuda')

    await userEvent.setup().click(screen.getByRole('button', { name: 'enviar' }))

    await screen.findByRole('alert')
    expect(screen.getByLabelText('Secreto')).toHaveAccessibleDescription('Texto de ayuda Muy corta')
  })

  it('es de texto por defecto', () => {
    render(<Harness />)

    expect(screen.getByLabelText('Secreto')).toHaveAttribute('type', 'text')
  })

  it('anuncia el error con rol alert y marca el campo como inválido', async () => {
    render(<Harness />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'enviar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Muy corta')
    expect(screen.getByLabelText('Secreto')).toBeInvalid()
  })
})
