export const PASS_ALONG_RESULT_MAX_CHARS = 4000

const NO_RESULT_PLACEHOLDER = '（暂无结果）'

export function truncateByCodePoints(text: string, maxChars: number): string {
  // Why: Array.from counts code points so truncation never splits a surrogate pair.
  const chars = Array.from(text)
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : text
}

/** Text sent to the receiving agent when the user drags a pass-along from A to B. */
export function composePassAlongPrompt(args: {
  fromTitle: string
  result: string | null
  note: string
}): string {
  const result = args.result?.trim()
    ? truncateByCodePoints(args.result, PASS_ALONG_RESULT_MAX_CHARS)
    : NO_RESULT_PLACEHOLDER
  const note = args.note.trim()
  const head = `来自〈${args.fromTitle}〉的结果：\n${result}`
  return note ? `${head}\n\n附言：${note}` : head
}
