type BackupPanelFeedbackProps = { message: string | null; errorText: string | null }

export function BackupPanelFeedback({ message, errorText }: BackupPanelFeedbackProps) {
  return (
    <>
      <div role="status" className="text-sm">
        {message ? <p>{message}</p> : null}
      </div>
      {errorText ? (
        <p role="alert" data-tone="error" className="text-sm font-medium text-destructive">
          Error: {errorText}
        </p>
      ) : null}
    </>
  )
}
