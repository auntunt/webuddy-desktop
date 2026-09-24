import type { AiVaultAgent } from '../../shared/ai-vault-types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../shared/execution-host'
import {
  ConversationWindowSink,
  EMPTY_AI_VAULT_CONVERSATION,
  type AiVaultConversationResult
} from './session-conversation-window'
import { fileWithMtimeForPath } from './session-first-user-prompt-read'
import { parseAgentSessionFile } from './session-scanner-agent-parser'
import { captureOpenCodeSqliteSession } from './session-scanner-opencode-sqlite-capture'
import {
  buildOpenCodeSqliteCandidatePath,
  splitOpenCodeSqliteCandidate
} from './session-scanner-opencode-sqlite-paths'

export type ReadAiVaultConversationArgs = {
  agent: AiVaultAgent
  filePath: string
  sessionId?: string
  executionHostId?: ExecutionHostId
  codexHome?: string | null
}

export type ReadAiVaultConversationResult = AiVaultConversationResult

/**
 * Re-parse one session transcript and return its normalized conversation,
 * windowed to the collection caps (first 200 + last 1800, 16 KB / 1 MB).
 */
export async function readAiVaultConversation(
  args: ReadAiVaultConversationArgs
): Promise<ReadAiVaultConversationResult> {
  const filePath = args.filePath.trim()
  if (!filePath || !args.agent) {
    return EMPTY_AI_VAULT_CONVERSATION
  }
  // Why: transcript bodies live on the session host; remote rows are not read here.
  if ((args.executionHostId ?? LOCAL_EXECUTION_HOST_ID) !== LOCAL_EXECUTION_HOST_ID) {
    return EMPTY_AI_VAULT_CONVERSATION
  }

  const sink = new ConversationWindowSink()
  try {
    const found = await readIntoSink(
      { ...args, filePath, sessionId: args.sessionId?.trim() || undefined },
      sink
    )
    return found ? sink.finish() : EMPTY_AI_VAULT_CONVERSATION
  } catch {
    // Partial/corrupt transcripts make parsers throw; treat as unavailable.
    return EMPTY_AI_VAULT_CONVERSATION
  }
}

async function readIntoSink(
  args: ReadAiVaultConversationArgs,
  sink: ConversationWindowSink
): Promise<boolean> {
  if (args.agent === 'opencode') {
    // Rows carry either the synthetic `db#id` path or the db path plus id.
    const sqlite =
      splitOpenCodeSqliteCandidate(args.filePath) ??
      (args.sessionId
        ? splitOpenCodeSqliteCandidate(
            buildOpenCodeSqliteCandidatePath(args.filePath, args.sessionId)
          )
        : null)
    if (sqlite) {
      const capture = await captureOpenCodeSqliteSession({
        ...sqlite,
        platform: process.platform
      })
      for (const message of capture.messages) {
        sink.push(message)
      }
      return capture.session !== null
    }
  }

  const file = await fileWithMtimeForPath(args.filePath, args.agent)
  if (!file) {
    return false
  }
  const session = await parseAgentSessionFile(
    { agent: args.agent, file, codexHome: args.codexHome ?? null },
    process.platform,
    sink
  )
  return session !== null
}
