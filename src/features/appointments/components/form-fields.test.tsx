import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useForm } from 'react-hook-form'
import { Form } from '@/components/ui/form'
import { SelectFormField, TextFormField, type SelectOption } from './form-fields'

type Values = { choice: string; when: string; plain: string }

const OPTIONS: readonly SelectOption[] = [
  { value: '1', label: 'Primera' },
  { value: '2', label: 'Segunda' },
]

type HarnessProps = { defaults?: Partial<Values>; withOptions?: readonly SelectOption[]; withoutDefaults?: boolean }

function Harness({ defaults = {}, withOptions = OPTIONS, withoutDefaults = false }: HarnessProps) {
  const form = useForm<Values>({ defaultValues: withoutDefaults ? {} : { choice: '', when: '', plain: '', ...defaults } })
  return (
    <Form {...form}>
      <form>
        <SelectFormField control={form.control} name="choice" label="Elección" options={withOptions} placeholder="Elige una" />
        <TextFormField control={form.control} name="when" label="Fecha" type="datetime-local" />
        <TextFormField control={form.control} name="plain" label="Texto" type="text" />
        <button type="button" onClick={() => form.setError('choice', { message: 'Elección inválida' })}>
          fallar select
        </button>
        <button type="button" onClick={() => form.setError('plain', { message: 'Texto inválido' })}>
          fallar texto
        </button>
      </form>
    </Form>
  )
}

describe('campos sin valor inicial', () => {
  it('el select cae al placeholder y el texto queda vacío cuando el valor es undefined', () => {
    render(<Harness withoutDefaults />)

    expect(screen.getByLabelText('Elección')).toHaveValue('')
    expect(screen.getByLabelText('Texto')).toHaveValue('')
    expect(screen.getByLabelText('Fecha')).toHaveValue('')
  })
})

describe('SelectFormField', () => {
  it('muestra el placeholder seleccionado cuando el valor está vacío', () => {
    render(<Harness />)

    const select = screen.getByLabelText('Elección')
    expect(select).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Elige una' })).toBeInTheDocument()
  })

  it('lista una opción por cada elemento con su etiqueta', () => {
    render(<Harness />)

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Elige una', 'Primera', 'Segunda'])
  })

  it('refleja el valor por defecto', () => {
    render(<Harness defaults={{ choice: '2' }} />)

    expect(screen.getByLabelText('Elección')).toHaveValue('2')
  })

  it('actualiza el valor al elegir una opción', async () => {
    render(<Harness />)

    await userEvent.setup().selectOptions(screen.getByLabelText('Elección'), 'Primera')

    expect(screen.getByLabelText('Elección')).toHaveValue('1')
  })

  it('solo ofrece el placeholder sin opciones', () => {
    render(<Harness withOptions={[]} />)

    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('muestra el mensaje de error y marca el campo inválido', async () => {
    render(<Harness />)
    expect(screen.getByLabelText('Elección')).not.toHaveAttribute('aria-invalid', 'true')

    await userEvent.setup().click(screen.getByRole('button', { name: 'fallar select' }))

    expect(await screen.findByText('Elección inválida')).toBeInTheDocument()
    expect(screen.getByLabelText('Elección')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('TextFormField', () => {
  it('usa el tipo y deja vacío un valor vacío', () => {
    render(<Harness />)

    expect(screen.getByLabelText('Texto')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Texto')).toHaveValue('')
    expect(screen.getByLabelText('Fecha')).toHaveAttribute('type', 'datetime-local')
  })

  it('aplica paso de 300 s solo al campo datetime-local', () => {
    render(<Harness />)

    expect(screen.getByLabelText('Fecha')).toHaveAttribute('step', '300')
    expect(screen.getByLabelText('Texto')).not.toHaveAttribute('step')
  })

  it('desactiva el autocompletado', () => {
    render(<Harness />)

    expect(screen.getByLabelText('Texto')).toHaveAttribute('autocomplete', 'off')
  })

  it('refleja el valor por defecto y permite escribir', async () => {
    render(<Harness defaults={{ plain: 'hola', when: '2026-11-13T10:00' }} />)
    const input = screen.getByLabelText('Texto')
    expect(input).toHaveValue('hola')
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-13T10:00')

    await userEvent.setup().type(input, '!')

    expect(input).toHaveValue('hola!')
  })

  it('muestra el mensaje de error y marca el campo inválido', async () => {
    render(<Harness />)
    expect(screen.queryByText('Texto inválido')).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'fallar texto' }))

    expect(await screen.findByText('Texto inválido')).toBeInTheDocument()
    expect(screen.getByLabelText('Texto')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Fecha')).not.toHaveAttribute('aria-invalid', 'true')
  })
})
