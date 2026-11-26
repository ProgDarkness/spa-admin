import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BackupPanelFeedback } from './backup-panel-feedback'

describe('BackupPanelFeedback', () => {
  it('mantiene la región de estado montada y vacía sin mensaje', () => {
    render(<BackupPanelFeedback message={null} errorText={null} />)

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('anuncia el mensaje dentro de la región de estado', () => {
    render(<BackupPanelFeedback message="Exportando respaldo…" errorText={null} />)

    expect(screen.getByRole('status')).toHaveTextContent('Exportando respaldo…')
  })

  it('muestra el error con rol alert y prefijo textual, sin depender del color', () => {
    render(<BackupPanelFeedback message={null} errorText="La frase no coincide" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Error: La frase no coincide')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
