import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'

describe('Card', () => {
  it('compone todas las partes con su data-slot y contenido', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Titulo</CardTitle>
          <CardDescription>Descripcion</CardDescription>
          <CardAction>Accion</CardAction>
        </CardHeader>
        <CardContent>Cuerpo</CardContent>
        <CardFooter>Pie</CardFooter>
      </Card>,
    )

    const slotByText = {
      Titulo: 'card-title',
      Descripcion: 'card-description',
      Accion: 'card-action',
      Cuerpo: 'card-content',
      Pie: 'card-footer',
    }
    for (const [text, slot] of Object.entries(slotByText)) {
      expect(screen.getByText(text)).toHaveAttribute('data-slot', slot)
    }
    expect(screen.getByText('Titulo').closest('[data-slot="card-header"]')).not.toBeNull()
    expect(screen.getByText('Cuerpo').closest('[data-slot="card"]')).toHaveAttribute('data-slot', 'card')
  })

  it('usa clases de token bg-card y border-border sin sombra', () => {
    const { container } = render(<Card>x</Card>)
    const card = container.firstElementChild as HTMLElement

    expect(card).toHaveClass('bg-card', 'border', 'border-border', 'text-card-foreground')
    expect(card.className).not.toMatch(/\bshadow/)
  })

  it('el titulo usa tipografia serif', () => {
    render(<CardTitle>Titulo</CardTitle>)

    expect(screen.getByText('Titulo')).toHaveClass('font-serif', 'font-semibold')
  })

  it('la descripcion usa el color muted-foreground', () => {
    render(<CardDescription>Desc</CardDescription>)

    expect(screen.getByText('Desc')).toHaveClass('text-muted-foreground', 'text-sm')
  })

  it('combina className y propaga props', () => {
    render(
      <Card className="extra" data-testid="card" id="mi-card">
        x
      </Card>,
    )

    const card = screen.getByTestId('card')
    expect(card).toHaveClass('extra', 'bg-card')
    expect(card).toHaveAttribute('id', 'mi-card')
  })
})
