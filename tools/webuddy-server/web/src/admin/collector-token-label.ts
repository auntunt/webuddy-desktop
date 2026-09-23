const COLLECTOR_PREFIX = 'collector:'

/** `collector:<deviceId>` (desktop collector tokens) reads better as a device hint than a UUID. */
export function tokenDisplayLabel(label: string | null): string {
  if (!label) {
    return '—'
  }
  if (!label.startsWith(COLLECTOR_PREFIX)) {
    return label
  }
  const deviceId = label.slice(COLLECTOR_PREFIX.length)
  return `采集器（设备 ${deviceId.slice(0, 8)} 前 8 位）`
}
