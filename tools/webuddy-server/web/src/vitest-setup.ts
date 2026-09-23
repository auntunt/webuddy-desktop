import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { clearToken } from './auth/token-store'

afterEach(() => {
  cleanup()
  // Clears the in-memory copy too, which localStorage.clear() would miss.
  clearToken()
  localStorage.clear()
})
