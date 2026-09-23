import type { ReactNode } from 'react'
import { cx } from './class-names'

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad'

const TONES: Record<Tone, string> = {
  neutral: 'border-line-strong text-dim',
  accent: 'border-accent text-accent',
  ok: 'border-ok text-ok',
  warn: 'border-warn text-warn',
  bad: 'border-bad text-bad'
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-px text-[11px] leading-4 font-medium whitespace-nowrap',
        TONES[tone]
      )}
    >
      {children}
    </span>
  )
}
