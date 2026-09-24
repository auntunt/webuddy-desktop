import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { completeArrayObjects, parseSkillReply } from '../lib/skill-json.mjs'

const a = { title: 'A', body: 'x' }
const b = { title: 'B "quoted" }{ ]', body: 'y\\n' }

describe('completeArrayObjects', () => {
  it('returns every complete top-level object of a truncated array', () => {
    const text = `[${JSON.stringify(a)}, ${JSON.stringify(b)}, {"title":"C","body":"cut off`
    assert.deepEqual(completeArrayObjects(text), [a, b])
  })

  it('ignores braces and brackets inside strings, including escaped quotes', () => {
    const tricky = { title: 'q \\" } ] [ {', body: '\\\\' }
    assert.deepEqual(completeArrayObjects(`[${JSON.stringify(tricky)},{"title"`), [tricky])
  })

  it('keeps nested objects and arrays intact', () => {
    const nested = { title: 'N', body: 'b', tags: ['a', 'b'], meta: { x: [1, { y: 2 }] } }
    assert.deepEqual(completeArrayObjects(`[${JSON.stringify(nested)}`), [nested])
  })

  it('returns [] when there is no array', () => {
    assert.deepEqual(completeArrayObjects('no json here'), [])
  })
})

describe('parseSkillReply', () => {
  it('parses a complete fenced array', () => {
    const reply = `好的：\n\`\`\`json\n${JSON.stringify([a, b])}\n\`\`\``
    assert.deepEqual(parseSkillReply(reply), { skills: [a, b], salvaged: false })
  })

  it('salvages complete objects from a truncated reply without a closing fence', () => {
    const reply = `\`\`\`json\n[${JSON.stringify(a)},{"title":"half`
    assert.deepEqual(parseSkillReply(reply), { skills: [a], salvaged: true })
  })

  it('salvages when told the reply hit the length limit even if brackets balance by chance', () => {
    const reply = `[${JSON.stringify(a)},{"title":"C","body":"[x]"`
    assert.deepEqual(parseSkillReply(reply, 'length'), { skills: [a], salvaged: true })
  })

  it('drops entries without title or body', () => {
    const reply = JSON.stringify([a, { title: 'no body' }, null])
    assert.deepEqual(parseSkillReply(reply).skills, [a])
  })

  it('treats an explicit empty array as a valid empty answer', () => {
    assert.deepEqual(parseSkillReply('[]'), { skills: [], salvaged: false })
  })

  it('keeps skills whose body contains a fenced code block, fenced or bare reply', () => {
    const withCode = { title: 'Bash', body: '步骤：\n```bash\nnpm test\n```\n完成' }
    const skills = [withCode, a]
    const bare = JSON.stringify(skills)
    assert.deepEqual(parseSkillReply(bare).skills, skills)
    assert.deepEqual(parseSkillReply(`\`\`\`json\n${bare}\n\`\`\``).skills, skills)
    assert.deepEqual(parseSkillReply(`好的：\n\`\`\`json\n${bare}\n\`\`\`\n以上。`).skills, skills)
    assert.deepEqual(
      parseSkillReply(`\`\`\`json\n[${JSON.stringify(withCode)},{"title":"cut`, 'length').skills,
      [withCode]
    )
  })

  it('treats a non-empty array with no valid skill as a parse failure', () => {
    assert.deepEqual(parseSkillReply(JSON.stringify([{ name: 'x', body: 'y' }])), {
      skills: null,
      salvaged: false
    })
  })

  it('returns null skills when nothing parses', () => {
    assert.deepEqual(parseSkillReply('sorry, I cannot'), { skills: null, salvaged: false })
  })
})
