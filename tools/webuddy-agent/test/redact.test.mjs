import { test } from 'node:test'
import assert from 'node:assert/strict'

import { maskPath, maskWslPath } from '../lib/redact.mjs'

test('maskPath: Windows homes compare case-insensitively and never match a sibling', () => {
  assert.equal(maskPath('c:\\users\\ALICE\\proj', 'C:\\Users\\alice'), '~\\proj')
  assert.equal(maskPath('C:/Users/alice/proj', 'C:\\Users\\alice\\'), '~/proj')
  assert.equal(maskPath('C:\\Users\\alice2\\proj', 'C:\\Users\\alice'), 'C:\\Users\\alice2\\proj')
  assert.equal(maskPath('/Users/alice2/p', '/Users/alice'), '/Users/alice2/p')
  assert.equal(maskPath('/Users/alice/p', ''), '/Users/alice/p')
})

test('maskWslPath: native and UNC WSL homes', () => {
  assert.equal(maskWslPath('/home/bob/proj'), '~/proj')
  assert.equal(maskWslPath('/root'), '~')
  assert.equal(maskWslPath('/homes/bob'), '/homes/bob')
  assert.equal(
    maskWslPath('\\\\wsl.localhost\\Ubuntu\\home\\bob\\.claude\\x.jsonl'),
    '~\\.claude\\x.jsonl'
  )
  assert.equal(maskWslPath('\\\\wsl$\\Debian\\home\\bob'), '~')
})
