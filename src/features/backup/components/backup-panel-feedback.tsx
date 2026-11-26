'use client'

import { useEffect, useRef } from 'react'

type BackupPanelFeedbackProps = { message: string | null; errorText: string | null }

export function BackupPanelFeedback({ message, errorText }: BackupPanelFeedbackProps) {
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (errorText) errorRef.current?.focus()
  }, [errorText])

  return (
    <>
      <div role="status" className="text-sm">
        {message ? <p>{message}</p> : null}
      </div>
      {errorText ? (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          data-tone="error"
          className="text-sm font-medium text-destructive outline-none"
        >
          Error: {errorText}
        </p>
      ) : null}
    </>
  )
}
