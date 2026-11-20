'use client'

import type { ComponentProps } from 'react'
import type { Control, FieldValues, Path } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

type DescribedInputProps = ComponentProps<typeof Input> & { describedBy?: string | undefined }

function DescribedInput({ describedBy, 'aria-describedby': slotDescribedBy, ...inputProps }: DescribedInputProps) {
  const describedByIds = [describedBy, slotDescribedBy].filter(Boolean).join(' ')
  return <Input aria-describedby={describedByIds || undefined} {...inputProps} />
}

type AuthTextFieldProps<Values extends FieldValues> = {
  control: Control<Values>
  name: Path<Values>
  label: string
  type?: 'text' | 'password' | undefined
  autoComplete?: string | undefined
  describedBy?: string | undefined
  spellCheck?: boolean | undefined
  autoCapitalize?: string | undefined
  autoCorrect?: string | undefined
}

export function AuthTextField<Values extends FieldValues>({
  control,
  name,
  label,
  type = 'text',
  autoComplete,
  describedBy,
  spellCheck,
  autoCapitalize,
  autoCorrect,
}: AuthTextFieldProps<Values>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <DescribedInput
              className="h-9 border-input"
              type={type}
              autoComplete={autoComplete}
              describedBy={describedBy}
              spellCheck={spellCheck}
              autoCapitalize={autoCapitalize}
              autoCorrect={autoCorrect}
              {...field}
            />
          </FormControl>
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  )
}
