'use client'

import { useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { Payment } from '@/lib/model'
import { formatCents } from '@/lib/money'
import { appErrorOf } from '@/lib/result'
import { useVoidPayment } from '../hooks'
import { voidFormSchema, type VoidFormValues } from '../schemas'

export type VoidDialogProps = { payment: Payment; onClose: () => void }

const UNEXPECTED_ERROR_MESSAGE = 'No se pudo anular el pago'

function useVoidSubmission(payment: Payment, onClose: () => void, form: UseFormReturn<VoidFormValues>) {
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const voidPayment = useVoidPayment()

  async function submit(values: VoidFormValues) {
    setFailureMessage(null)
    const parsed = voidFormSchema.safeParse(values)
    if (!parsed.success) {
      form.setError('reason', { message: parsed.error.issues[0]?.message ?? UNEXPECTED_ERROR_MESSAGE })
      return
    }
    try {
      await voidPayment.mutateAsync({ id: payment.id, reason: parsed.data.reason })
      onClose()
    } catch (caught) {
      setFailureMessage(appErrorOf(caught)?.message ?? UNEXPECTED_ERROR_MESSAGE)
    }
  }

  return { failureMessage, submit, isPending: voidPayment.isPending }
}

export function VoidDialog({ payment, onClose }: VoidDialogProps) {
  const form = useForm<VoidFormValues>({ defaultValues: { reason: '' } })
  const { failureMessage, submit, isPending } = useVoidSubmission(payment, onClose, form)

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anular pago</DialogTitle>
          <DialogDescription>
            {`El pago de ${formatCents(payment.amountCents, payment.currency)} quedará tachado y no sumará en los totales. No se elimina.`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo de la anulación</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {failureMessage ? (
              <p role="alert" className="text-sm text-destructive">
                {failureMessage}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={isPending}>
                Confirmar anulación
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
