import type { Control, FieldValues, Path } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/native-select'

export type SelectOption = { value: string; label: string }

type FieldProps<Values extends FieldValues> = {
  control: Control<Values>
  name: Path<Values>
  label: string
}

type SelectFormFieldProps<Values extends FieldValues> = FieldProps<Values> & {
  options: readonly SelectOption[]
  placeholder: string
}

type TextFormFieldProps<Values extends FieldValues> = FieldProps<Values> & {
  type: 'datetime-local' | 'text'
}

const DATE_TIME_STEP_SECONDS = 300

export function SelectFormField<Values extends FieldValues>({
  control,
  name,
  label,
  options,
  placeholder,
}: SelectFormFieldProps<Values>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <NativeSelect {...field} value={String(field.value ?? '')}>
              <option value="">{placeholder}</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function TextFormField<Values extends FieldValues>({ control, name, label, type }: TextFormFieldProps<Values>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              autoComplete="off"
              type={type}
              step={type === 'datetime-local' ? DATE_TIME_STEP_SECONDS : undefined}
              {...field}
              value={String(field.value ?? '')}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
