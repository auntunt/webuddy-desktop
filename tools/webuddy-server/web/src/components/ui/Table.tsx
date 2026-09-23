import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cx } from './class-names'

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cx('w-full border-collapse text-[12.5px] tabular-nums', className)}
        {...rest}
      />
    </div>
  )
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cx(
        'border-b border-line px-2.5 py-2 text-left text-[11px] font-medium text-faint',
        className
      )}
      {...rest}
    />
  )
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cx('border-b border-line last:border-b-0 hover:bg-hover', className)}
      {...rest}
    />
  )
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx('px-2.5 py-2 text-fg', className)} {...rest} />
}
