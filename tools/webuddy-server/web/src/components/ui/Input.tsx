import type { InputHTMLAttributes } from 'react'
import { cx } from './class-names'

export const controlClass =
  'rounded-control border border-line-strong bg-bg px-2.5 py-1.5 text-[12.5px] text-fg transition-colors placeholder:text-faint hover:border-line-hover focus:border-fg focus:outline-none'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(controlClass, className)} {...rest} />
}
