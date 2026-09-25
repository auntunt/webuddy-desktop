import { describe, expect, it } from 'vitest'
import { collectTouchedFiles, extractEditedPaths } from './session-touched-files-model'

const at = 0

describe('extractEditedPaths', () => {
  it('reads a plain path preview from edit tools', () => {
    expect(extractEditedPaths({ toolName: 'Edit', toolInput: 'src/app.ts', at })).toEqual([
      'src/app.ts'
    ])
  })

  it('ignores non-edit tools', () => {
    expect(extractEditedPaths({ toolName: 'Bash', toolInput: 'rm src/app.ts', at })).toEqual([])
    expect(extractEditedPaths({ toolName: 'Read', toolInput: 'src/app.ts', at })).toEqual([])
  })

  it('reads complete JSON path fields and skips a truncated value', () => {
    expect(
      extractEditedPaths({
        toolName: 'str_replace',
        toolInput: '{"path":"/w/a.ts","old_str":"x',
        at
      })
    ).toEqual(['/w/a.ts'])
    expect(
      extractEditedPaths({
        toolName: 'write_file',
        toolInput: '{"content":"…","file_path":"/w/very/lo',
        at
      })
    ).toEqual([])
  })

  it('reads apply_patch file headers', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** Add File: src/b.ts\n+x'
    expect(extractEditedPaths({ toolName: 'apply_patch', toolInput: patch, at })).toEqual([
      'src/a.ts',
      'src/b.ts'
    ])
  })
})

describe('collectTouchedFiles', () => {
  it('normalizes to repo-relative paths and dedupes', () => {
    const history = [
      { toolName: 'Edit', toolInput: '/work/app/src/a.ts', at },
      { toolName: 'Write', toolInput: './src/a.ts', at },
      { toolName: 'MultiEdit', toolInput: '/elsewhere/b.ts', at },
      { toolName: 'Bash', toolInput: 'ls', at }
    ]
    expect(collectTouchedFiles(history, '/work/app')).toEqual(['src/a.ts', '/elsewhere/b.ts'])
  })

  it('treats a missing history as no files', () => {
    expect(collectTouchedFiles(undefined, '/work/app')).toEqual([])
  })
})
