import type { AgentActionHistoryEntry } from '../../../../shared/agent-status-types'
import {
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../../../shared/cross-platform-path'

// Lowercased tool names (see shared tool-input-preview) whose input names a file they modify.
const FILE_EDIT_TOOLS = new Set([
  'edit',
  'write',
  'create',
  'multiedit',
  'notebookedit',
  'write_file',
  'edit_file',
  'replace',
  'search_replace',
  'write_to_file',
  'apply_patch',
  'patch',
  'replace_file_content',
  'multi_replace_file_content',
  'str_replace',
  'str_replace_editor',
  'str_replace_based_edit_tool'
])

// Why: the preview is ≤200 chars and may be cut mid-JSON; require the closing quote so a
// truncated value never becomes a fabricated shorter path.
const JSON_PATH_FIELD =
  /"(?:file_path|filePath|path|filename|notebook_path|TargetFile)"\s*:\s*"((?:[^"\\]|\\.)+)"/g
const PATCH_FILE_HEADER = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm

function unescapeJsonString(value: string): string {
  return value.replace(/\\(["\\/])/g, '$1')
}

/** Paths named by one edit-type action preview; empty when none can be read safely. */
export function extractEditedPaths(entry: AgentActionHistoryEntry): string[] {
  if (!FILE_EDIT_TOOLS.has(entry.toolName.trim().toLowerCase()) || !entry.toolInput) {
    return []
  }
  const input = entry.toolInput.trim()
  const jsonPaths = [...input.matchAll(JSON_PATH_FIELD)].map((m) => unescapeJsonString(m[1]))
  if (jsonPaths.length > 0) {
    return jsonPaths
  }
  const patchPaths = [...input.matchAll(PATCH_FILE_HEADER)].map((m) => m[1].trim())
  if (patchPaths.length > 0) {
    return patchPaths
  }
  if (input.startsWith('{') || input.startsWith('*** ')) {
    return []
  }
  // Plain previews carry the path itself (e.g. Edit → "src/app.ts").
  const leading = input.split(/\r?\n/, 1)[0].trim()
  return leading ? [leading] : []
}

function toComparablePath(path: string, worktreePath: string | null): string {
  if (worktreePath && isRuntimePathAbsolute(path)) {
    const relative = relativePathInsideRoot(worktreePath, path)
    if (relative) {
      return relative.replace(/\\/g, '/')
    }
  }
  if (!isRuntimePathAbsolute(path)) {
    return path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  }
  return normalizeRuntimePathForComparison(path)
}

/** Files a session edited per its action feed, repo-relative when inside `worktreePath`. */
export function collectTouchedFiles(
  actionHistory: readonly AgentActionHistoryEntry[] | undefined,
  worktreePath: string | null
): string[] {
  const files = new Set<string>()
  for (const entry of actionHistory ?? []) {
    for (const path of extractEditedPaths(entry)) {
      files.add(toComparablePath(path, worktreePath))
    }
  }
  return [...files]
}
