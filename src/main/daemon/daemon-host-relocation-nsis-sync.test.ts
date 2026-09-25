import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOST_SUBDIR, LOCAL_HOST_ROOT_NAME } from './daemon-host-relocation'

describe('daemon host relocation / NSIS uninstall sync', () => {
  it('removes the same LOCALAPPDATA folder the relocation writes to', () => {
    const hooks = readFileSync(
      join(__dirname, '../../../config/nsis/orca-installer-hooks.nsh'),
      'utf8'
    )
    expect(hooks).toContain(`RMDir /r "$LOCALAPPDATA\\${LOCAL_HOST_ROOT_NAME}\\${HOST_SUBDIR}"`)
  })
})
