import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './class-names'

export type CardProps = {
  title?: ReactNode
  actions?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, 'title'>

export function Card({ title, actions, className, children, ...rest }: CardProps) {
  return (
    <section className={cx('rounded-card border border-line bg-card p-4', className)} {...rest}>
      {(title || actions) && (
        <header className="mb-3 flex items-center gap-2">
          {title && (
            <h2 className="text-[11px] font-semibold tracking-wider text-faint uppercase">
              {title}
            </h2>
          )}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
