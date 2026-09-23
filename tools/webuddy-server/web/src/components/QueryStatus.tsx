import type { ReactNode } from 'react'

type QueryStatusProps = {
  isPending: boolean
  error: Error | null
  isEmpty?: boolean
  emptyText?: ReactNode
  children: ReactNode
}

/** One place for the loading / error / empty lines every data card needs. */
export function QueryStatus({
  isPending,
  error,
  isEmpty = false,
  emptyText = '没有数据',
  children
}: QueryStatusProps) {
  if (error) {
    return <StatusLine tone="bad">加载失败：{error.message}</StatusLine>
  }
  if (isPending) {
    return <StatusLine>加载中…</StatusLine>
  }
  if (isEmpty) {
    return <StatusLine>{emptyText}</StatusLine>
  }
  return children
}

export function StatusLine({ tone, children }: { tone?: 'bad'; children: ReactNode }) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={
        tone === 'bad'
          ? 'py-10 text-center text-[12.5px] text-bad'
          : 'py-10 text-center text-[12.5px] text-faint'
      }
    >
      {children}
    </div>
  )
}
