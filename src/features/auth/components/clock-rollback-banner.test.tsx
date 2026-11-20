import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClockRollbackBanner } from './clock-rollback-banner'

describe('ClockRollbackBanner', () => {
  it('avisa con rol alert e incluye ambas fechas legibles', () => {
    render(<ClockRollbackBanner lastRecordedAt="2026-11-12T10:00:00" detectedAt="2026-11-10 08:00:00" />)

    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('La fecha del equipo retrocedió')
    expect(banner).toHaveTextContent('Último registro: 12/11/2026 10:00')
    expect(banner).toHaveTextContent('Fecha detectada: 10/11/2026 08:00')
    expect(banner).not.toHaveTextContent('T10:00')
    expect(banner).not.toHaveTextContent('10:00:00')
  })

  it('muestra tal cual una fecha que no entiende', () => {
    render(<ClockRollbackBanner lastRecordedAt="desconocida" detectedAt="2026-11-10T08:00:00" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Último registro: desconocida')
  })
})
