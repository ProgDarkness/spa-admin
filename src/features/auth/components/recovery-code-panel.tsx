'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type RecoveryCodePanelProps = { heading: string; code: string; onContinue: () => void }

export function RecoveryCodePanel({ heading, code, onContinue }: RecoveryCodePanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [hasSavedCode, setHasSavedCode] = useState(false)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="grid w-full max-w-sm gap-4">
      <h2 ref={headingRef} tabIndex={-1} className="font-serif text-xl font-semibold outline-none">
        {heading}
      </h2>
      <p className="text-sm text-muted-foreground">
        Guárdalo en papel o en un gestor de contraseñas seguro. Con este código recuperas el acceso si olvidas tu
        contraseña y no volverá a mostrarse.
      </p>
      <code className="select-all rounded-md border border-border bg-background p-3 text-center font-mono text-lg tracking-wider">
        {code}
      </code>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={hasSavedCode}
          onChange={(event) => setHasSavedCode(event.target.checked)}
        />
        Guardé mi código de recuperación
      </label>
      <Button type="button" disabled={!hasSavedCode} onClick={onContinue}>
        Continuar
      </Button>
    </div>
  )
}
