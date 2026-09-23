import { describe, expect, it } from 'vitest'
import { tokenDisplayLabel } from './collector-token-label'

describe('tokenDisplayLabel', () => {
  it('shows a dash for no label', () => {
    expect(tokenDisplayLabel(null)).toBe('—')
  })

  it('passes through a non-collector label unchanged', () => {
    expect(tokenDisplayLabel('dashboard')).toBe('dashboard')
  })

  it('formats a collector label as a device hint using the first 8 characters', () => {
    expect(tokenDisplayLabel('collector:a1b2c3d4e5f6')).toBe('采集器（设备 a1b2c3d4 前 8 位）')
  })

  it('formats a short device id without padding', () => {
    expect(tokenDisplayLabel('collector:ab12')).toBe('采集器（设备 ab12 前 8 位）')
  })
})
