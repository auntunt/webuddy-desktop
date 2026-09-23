import { X } from 'lucide-react'
import { useEffect, useId, type ReactNode } from 'react'
import { Button } from './Button'

export type DialogProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const titleId = useId()
  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) {
    return null
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-card border border-line-strong bg-card"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <Button variant="ghost" size="sm" className="ml-auto" aria-label="关闭" onClick={onClose}>
            <X size={14} />
          </Button>
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
