import { useEffect, useRef, useState } from 'react'

/** Follows `value` at most once per `intervalMs`: leading edge after a quiet period, then trailing. */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value)
  const lastAppliedAtRef = useRef(Number.NEGATIVE_INFINITY)
  const latestRef = useRef(value)
  latestRef.current = value

  useEffect(() => {
    if (Object.is(value, throttled)) {
      return
    }
    const apply = (): void => {
      lastAppliedAtRef.current = Date.now()
      setThrottled(() => latestRef.current)
    }
    const wait = lastAppliedAtRef.current + intervalMs - Date.now()
    if (wait <= 0) {
      apply()
      return
    }
    const timer = setTimeout(apply, wait)
    return () => clearTimeout(timer)
  }, [value, throttled, intervalMs])

  return throttled
}
