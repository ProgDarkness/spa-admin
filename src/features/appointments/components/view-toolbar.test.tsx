import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { freezeDate } from '@/test/clock'
import type { AgendaView } from '../period'
import { ViewToolbar } from './view-toolbar'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
})

function renderToolbar(view: AgendaView, date = '2026-11-20') {
  const onViewChange = vi.fn()
  const onDateChange = vi.fn()
  const user = userEvent.setup()
  render(<ViewToolbar view={view} date={date} onViewChange={onViewChange} onDateChange={onDateChange} />)
  return { onViewChange, onDateChange, user }
}

describe('ViewToolbar', () => {
  it('marca la vista activa con aria-pressed', () => {
    renderToolbar('day')

    const group = screen.getByRole('group', { name: 'Vista' })
    expect(group).toContainElement(screen.getByRole('button', { name: 'Día' }))
    expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('cambia de vista al pulsar el otro botón', async () => {
    const { onViewChange, user } = renderToolbar('day')

    await user.click(screen.getByRole('button', { name: 'Semana' }))

    expect(onViewChange).toHaveBeenCalledWith('week')
  })

  it('en vista día avanza y retrocede un día', async () => {
    const { onDateChange, user } = renderToolbar('day')

    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await user.click(screen.getByRole('button', { name: 'Anterior' }))

    expect(onDateChange).toHaveBeenNthCalledWith(1, '2026-11-21')
    expect(onDateChange).toHaveBeenNthCalledWith(2, '2026-11-19')
  })

  it('en vista semana avanza y retrocede siete días', async () => {
    const { onDateChange, user } = renderToolbar('week')

    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    await user.click(screen.getByRole('button', { name: 'Anterior' }))

    expect(onDateChange).toHaveBeenNthCalledWith(1, '2026-11-27')
    expect(onDateChange).toHaveBeenNthCalledWith(2, '2026-11-13')
  })

  it('Hoy salta a la fecha actual', async () => {
    const { onDateChange, user } = renderToolbar('week')

    await user.click(screen.getByRole('button', { name: 'Hoy' }))

    expect(onDateChange).toHaveBeenCalledWith('2026-11-12')
  })

  it('el selector de fecha muestra la fecha y notifica cambios válidos', () => {
    const { onDateChange } = renderToolbar('day')
    const input = screen.getByLabelText('Fecha')

    expect(input).toHaveValue('2026-11-20')
    fireEvent.change(input, { target: { value: '2026-12-01' } })

    expect(onDateChange).toHaveBeenCalledWith('2026-12-01')
  })

  it('ignora un selector de fecha vacío', () => {
    const { onDateChange } = renderToolbar('day')

    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '' } })

    expect(onDateChange).not.toHaveBeenCalled()
  })

  it('anuncia el período visible', () => {
    renderToolbar('week', '2026-11-12')

    expect(screen.getByRole('status')).toHaveTextContent(/9/)
    expect(screen.getByRole('status')).toHaveTextContent(/15/)
  })
})
