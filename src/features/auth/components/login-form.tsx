'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { LoginCredentials } from '@/lib/model'
import { useSession } from '@/lib/session'
import { loginFormSchema } from '../schemas'

const EMPTY_CREDENTIALS: LoginCredentials = { username: '', password: '' }

function LoginFields({ control }: { control: Control<LoginCredentials> }) {
  return (
    <>
      <FormField
        control={control}
        name="username"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Usuario</FormLabel>
            <FormControl>
              <Input className="h-9 border-input" autoComplete="username" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="password"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Contraseña</FormLabel>
            <FormControl>
              <Input className="h-9 border-input" type="password" autoComplete="current-password" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

export function LoginForm() {
  const { signIn } = useSession()
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null)
  const form = useForm<LoginCredentials>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: EMPTY_CREDENTIALS,
  })

  async function submit(credentials: LoginCredentials) {
    setAuthErrorMessage(null)
    const result = await signIn(credentials.username, credentials.password)
    if (result.status === 'error') setAuthErrorMessage(result.error.message)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid w-full max-w-sm gap-4" noValidate>
        <LoginFields control={form.control} />
        {authErrorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {authErrorMessage}
          </p>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Ingresar
        </Button>
      </form>
    </Form>
  )
}
