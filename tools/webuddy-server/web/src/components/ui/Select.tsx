import type { SelectHTMLAttributes } from 'react'
import { cx } from './class-names'
import { controlClass } from './Input'

export type SelectOption = {
  value: string
  label: string
}

export type SelectProps = {
  options: SelectOption[]
  placeholder?: string
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'>

// Native select: keyboard, mobile pickers and a11y for free; enough for filter dropdowns.
export function Select({ options, placeholder, className, ...rest }: SelectProps) {
  return (
    <select className={cx(controlClass, 'cursor-pointer', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
