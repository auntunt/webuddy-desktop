import type { ButtonHTMLAttributes } from 'react'
import { cx } from './class-names'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'border-fg bg-fg text-bg font-medium hover:border-fg-hover hover:bg-fg-hover',
  secondary: 'border-line-strong bg-card text-fg hover:border-line-hover hover:bg-hover',
  ghost: 'border-transparent bg-transparent text-dim hover:bg-hover hover:text-fg',
  danger: 'border-line-strong bg-card text-bad hover:border-bad hover:bg-bad-soft'
}

export type ButtonProps = {
  variant?: Variant
  size?: 'sm' | 'md'
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-control border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-[12.5px]',
        VARIANTS[variant],
        className
      )}
      {...rest}
    />
  )
}
