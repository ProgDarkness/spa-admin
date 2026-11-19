import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/model'
import { FailureAlert } from './failure-alert'

const FORM_FIELDS = ['clientId', 'startsAt']

function failureWith(overrides: Partial<AppError>): AppError {
  return { code: 'overlap', message: 'El recurso ya tiene una cita en ese horario', field: null, entityIds: null, ...overrides }
}

describe('FailureAlert', () => {
  it('no renderiza nada sin error', () => {
    render(<FailureAlert failure={null} formFields={FORM_FIELDS} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('muestra el mensaje cuando el error no pertenece a un campo del formulario', () => {
    render(<FailureAlert failure={failureWith({ field: null })} formFields={FORM_FIELDS} />)

    expect(screen.getByRole('alert')).toHaveTextContent('El recurso ya tiene una cita en ese horario')
  })

  it('marca la alerta con data-tone=error', () => {
    render(<FailureAlert failure={failureWith({ field: null })} formFields={FORM_FIELDS} />)

    expect(screen.getByRole('alert')).toHaveAttribute('data-tone', 'error')
  })

  it('omite el mensaje cuando ya se muestra junto al campo', () => {
    render(<FailureAlert failure={failureWith({ field: 'startsAt' })} formFields={FORM_FIELDS} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lista las citas en conflicto aunque el mensaje esté en el campo', () => {
    render(<FailureAlert failure={failureWith({ field: 'startsAt', entityIds: [41, 42] })} formFields={FORM_FIELDS} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Citas en conflicto: #41, #42')
    expect(alert).not.toHaveTextContent('El recurso ya tiene')
  })

  it('combina mensaje y conflictos cuando no hay campo', () => {
    render(<FailureAlert failure={failureWith({ entityIds: [5] })} formFields={FORM_FIELDS} />)

    expect(screen.getByRole('alert')).toHaveTextContent('El recurso ya tiene una cita en ese horario')
    expect(screen.getByRole('alert')).toHaveTextContent('Citas en conflicto: #5')
  })
})
