# 全 agent 采集（复用 Orca AI Vault）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 桌面端通过 Orca 已有的 AI Vault 扫描器采集全部 18 个 agent 的会话（本机 + WSL），附带整理好的对话文本上传；看板会话详情可读显示对话。

**Architecture:**
```
main: listAiVaultSessions → 与游标比对 → 对变化的会话调用扫描服务新操作 `conversation`
    → 写 ~/.webuddy-agent/manifest.jsonl → 拉起 `webuddy-agent scan --manifest <file>` → `push`（不变）
```
脱敏、哈希、outbox 仍在 .mjs 采集器里做（`lib/redact.mjs` 不移植），主进程只负责"发现 + 取对话"。SSH 主机留到第二期（远端读正文需要新的 relay RPC，属于需要能力协商的线协议变更）。

**Tech Stack:** Electron 主进程 TypeScript + vitest；AI Vault 扫描服务子进程（`session-scanner-service-*`）；零依赖 .mjs 采集器（`node --test`）；零依赖服务端（`node --test`）；React 看板（vitest，测试文件必须 `*.test.tsx`）。

**Spec（设计依据，均为已核实的代码位置）：**
- 列会话：`listAiVaultSessions({ unlimited: true })`（`src/main/ai-vault/cached-session-list.ts:81`）。不要用 `src/main/ipc/ai-vault.ts:84` 的 IPC 版（会扇出到所有主机）。它共享 UI 的 60s 缓存与扫描合并器，在后台子进程（`session-scanner-background.ts:47`，384MB 堆、低优先级）里扫描，Windows 上已含 WSL。
- 取对话：各 parser 都向 `TranscriptMessageSink` 输出规范化消息（`session-transcript-consumers.ts:11-23`，入口 `parseAgentSessionFile` `session-scanner-agent-parser.ts:58`）。新增服务操作 `conversation`，仿照 `firstPrompt`（`session-first-user-prompt-read.ts:28-103`，`session-scanner-service-entry.ts:86-91`）；OpenCode SQLite 走 `parseOpenCodeSqliteSession`；放在 `'cache'` 通道（`session-scanner-service-protocol.ts` 约 124 行）让交互搜索优先；非本机主机返回空（同 `session-first-user-prompt-read.ts:38-41`）。进程内兜底仿 `readAiVaultFirstUserPromptInBackground`（`session-scanner-background.ts:73`）。
- Claude 子代理：AI Vault 主扫描跳过 `subagents/`（`session-scanner-claude-subagents.ts:69`），而现有采集器会上传它们。对 `subagentTranscriptCount > 0` 的变化父会话调用 `listAiVaultSubagentSessionsInBackground`（`session-scanner-background.ts:65`）。

## Global Constraints

- 仓库规则（AGENTS.md）：复用优先；注释只写简短 Why；文件 ≤300 行（不加豁免）；类型断言避免（必要时 `SAFETY:`）；跨平台（`path.join`，Windows/WSL 路径）；子进程走现有 `runStep` 模式（`session-collector.ts` 存量，不扩大 `node:child_process` 直接使用面）。
- **去重兼容**：已上传的 claude-code / codex 行必须原地更新而不是新增：agent id `claude`→`claude-code`，其余 id 原样（`codex` 不变）；`transcript.relPath` = `path.relative(homedir, filePath)`，与 `tools/webuddy-agent/lib/collectors.mjs:222` 完全一致；家目录以外（WSL）加前缀 `wsl:<distro>/…`；`session.id` 与现有一致（Claude 记录的 `sessionId`，Codex `payload.id`）。
- **字段映射**：startedAt = createdAt ?? 首条消息时间 ?? modifiedAt；endedAt = updatedAt ?? 末条消息时间 ?? modifiedAt；durationMs = 差值且 ≥0；messageCount 直取；turnCount = user 消息数（截断前统计）；tokens = `{input:null, output:null, total: totalTokens || null}`；workspace = `maskPath(cwd)`、branch、repo:null；agent.version = null；agent.label：claude→`'Claude Code'`，其余用 `AI_VAULT_AGENT_LABELS`。
- **localDate**：用系统时区 `Intl.DateTimeFormat('en-CA', { timeZone })` 计算，替换 `schema.mjs` 中按"当前 UTC 偏移"计算的 `localDateOf`（夏令时跨越会错）。
- **正文**：`transcript` 字符串：原始文件为 `.jsonl/.json` 且 ≤ `maxTranscriptBytes` 时仍发脱敏原文（同今天）；数据库型 agent（OpenCode SQLite、Devin、Cursor 等非文件行）发脱敏后的对话 JSONL，`transcript.format = 'webuddy.conversation.v1'`，sha256 取该文本。新增同级可选字段 `conversation: [{role, text, timestamp}]`（脱敏）：保留前 200 + 后 1800 条，总 ≤1MB，单条 ≤16KB，并在记录中标 `transcript.conversationTruncated`。旧服务端只读 `payload.transcript`，多出字段被忽略（线兼容）。
- **游标**：主进程持有 `~/.webuddy-agent/vault-cursor.json`，键 `agent\0filePath\0sessionId`，值 `{modifiedAt, updatedAt, messageCount, totalTokens}`；只把变化的会话写入 manifest；仅当 `scan --manifest` 退出码为 0 时才保存游标（`runStep` 需返回退出码）。采集器 `state.json` 的 sha256 仍作第二道保险。
- **性能**：每轮最多 200 个变化会话，按最新优先，余量下轮继续；主进程逐行写 manifest，同一时间只持有一个 ≤1MB 的对话；整轮 fire-and-forget，服务错误吞掉（同 `runStep`），`inFlight` 保证单轮。
- **采集器 `scan`**：app 改用 `scan --manifest <file>`；旧的发现式 `scan` 保留一个版本供命令行用户使用并打弃用提示。`tools/webuddy-agent/index.mjs` 已 377 行，需把扫描逻辑移到 `lib/scan.mjs`。
- **服务端**：`sessions.conversation_json TEXT` 幂等迁移（仿 `lib/group-schema.mjs`，放新文件，不增长已超 300 行的 `db.mjs`——若必须改 `toRow`/upsert，改动控制在最小并尽量把新逻辑放新文件）；upsert 对 `conversation_json`、`agent_version` 用 `COALESCE(excluded.x, sessions.x)`；`REQUIRED_PATHS` 不变；`conversation` 超过 2MB 时丢弃该字段而非拒收记录。
- **看板**：会话详情有 `conversation_json` 时按对话气泡显示（角色、时间、文本，纯文本渲染，不解析 HTML/Markdown 以免 XSS），否则回退原始 `<pre>`；列表页无需改动（agent 标签来自数据）。
- **SSH**：本期不采集 SSH 远端会话。若任何代码触及远端状态，只能用 `live / unverifiable / exited` 词汇，连不上 ≠ 会话不存在（见 `docs/reference/ssh-execution-boundary.md`）。
- 验证：`pnpm test <paths>`、`pnpm tc:node`、`npx oxlint <files>`、`pnpm run check:code-quality:changed`；tools 下 `node --test`；web 下 `npm test && npx tsc --noEmit`。不在仓库根跑 `pnpm format`；不用 `--no-verify`。

---

### Task 1: 扫描服务新增 `conversation` 操作
**Files:** Create `src/main/ai-vault/session-conversation-read.ts`（+ test）；Modify `session-scanner-service-protocol.ts`、`session-scanner-service-entry.ts`、`session-scanner-service-spawn.ts`（如需）、`session-scanner-background.ts`（导出 `readAiVaultConversationInBackground`，含进程内兜底）。
**Produces:** `readAiVaultConversationInBackground({ agent, filePath, sessionId?, executionHostId?, codexHome? }) → Promise<{ messages: Array<{role:'user'|'assistant'|'system'|'tool'|'unknown', text:string, timestamp:string|null}>, truncated: boolean, totalMessages: number }>`；按 Global Constraints 的上限做头 200 + 尾 1800、单条 16KB、总 1MB 截断。
- [ ] 测试：用 `session-scanner-every-agent-fixture.ts` 断言每个 agent 都返回消息；截断规则；OpenCode SQLite 路径；非本机主机返回空。
- [ ] 实现 → `pnpm test src/main/ai-vault` 相关文件、`pnpm tc:node`、oxlint → Commit `feat(ai-vault): 扫描服务支持读取完整对话`

### Task 2: AiVaultSession → manifest 条目的纯映射
**Files:** Create `src/main/webuddy/vault-session-manifest.ts`（+ test）。
**Produces:** `toManifestEntry(session: AiVaultSession, conversation, { homeDir, timeZone }) → WebuddyManifestEntry`，字段按 Global Constraints；manifest 行格式（JSON 每行一个）：`{ agentId, agentLabel, sessionId, filePath, relPath, transcriptFormat: 'raw-file'|'webuddy.conversation.v1', startedAt, endedAt, durationMs, messageCount, turnCount, tokensTotal, model, cwd, branch, conversation, conversationTruncated }`。
- [ ] 测试：claude→claude-code；relPath 与 `path.relative` 相同；WSL 前缀；时间回退链；数据库型 agent 的 transcriptFormat。
- [ ] 实现 → 验证 → Commit `feat(webuddy): AI Vault 会话映射为采集清单条目`

### Task 3: 游标存储
**Files:** Create `src/main/webuddy/vault-session-cursor.ts`（+ test）。
**Produces:** `loadVaultCursor(env?)`, `diffVaultSessions(sessions, cursor, { limit: 200 }) → { changed: AiVaultSession[], nextCursorEntries }`（最新优先）、`saveVaultCursor(entries, env?)`（tmp+rename 原子写，0600）；目录与 `collector-config.ts` 的 `collectorStateDir` 一致。
- [ ] 测试：比对、限额与排序、原子写、损坏文件回退为空。
- [ ] 实现 → 验证 → Commit `feat(webuddy): AI Vault 采集游标`

### Task 4: 编排：导出 → scan --manifest → push
**Files:** Create `src/main/webuddy/vault-session-export.ts`（+ test）；Modify `src/main/webuddy/session-collector.ts`（`runStep` 返回退出码；流程改为 export → `scan --manifest <path>` → 仅当退出码 0 时保存游标 → `push`）、`session-collector.test.ts`。
**Consumes:** Task 1–3；`listAiVaultSessions({ unlimited: true })`；`listAiVaultSubagentSessionsInBackground`（父会话 `subagentTranscriptCount > 0` 时）。
- [ ] 测试（注入假的 list/conversation）：只导出变化会话；200 上限；scan 非 0 不保存游标；服务报错不抛出；manifest 逐行写入。
- [ ] 实现 → `pnpm test src/main/webuddy`、`pnpm tc:node`、oxlint → Commit `feat(webuddy): 采集改用 AI Vault 覆盖全部 agent`

### Task 5: 采集器支持 `scan --manifest`
**Files:** Create `tools/webuddy-agent/lib/scan.mjs`（从 index.mjs 抽出现有扫描）、`lib/manifest.mjs`、`test/manifest.test.mjs`；Modify `index.mjs`（新参数；旧发现式 scan 打印弃用提示）、`lib/schema.mjs`（`localDate` 用 `Intl`；`buildSessionRecord` 支持 conversation 与 `webuddy.conversation.v1`）、`lib/upload.mjs`（payload 带上 `conversation`）。
- [ ] 测试：同一个 Claude/Codex fixture，manifest 路径生成的记录与旧扫描的 `dedupeKey` 完全一致；conversation 经过脱敏（密钥被替换）；数据库型条目的 sha256 取对话文本；localDate 在夏令时边界正确；outbox 格式不变。
- [ ] 实现 → `node --test` → Commit `feat(webuddy-agent): 支持按清单生成记录并携带对话`

### Task 6: 服务端存对话
**Files:** Create `tools/webuddy-server/lib/conversation-schema.mjs`（迁移）；Modify `lib/db.mjs`（`toRow` 存 `conversation_json`；upsert 对 `conversation_json`、`agent_version` 用 COALESCE——改动最小）、`lib/ingest-validation.mjs`（>2MB 丢弃字段）、`lib/queries.mjs`（`getSession` 返回解析后的 `conversation`，列表查询不返回它）。
- [ ] 测试：旧格式 payload 仍被接受；新 payload 存下对话；不带对话的重传保留已存对话；超大对话被丢弃但记录被接受；列表接口不含对话。
- [ ] 实现 → `node --test` → Commit `feat(webuddy-server): 存储并返回规范化对话`

### Task 7: 看板会话详情显示对话
**Files:** Create `web/src/session-detail/ConversationView.tsx`（+ `.test.tsx`）；Modify `web/src/session-detail/TranscriptView.tsx` 或 `SessionDetailPage.tsx`、`web/src/api/types.ts`。
- 有 conversation：按角色区分的消息列表（用户 / 助手 / 工具 / 系统），显示时间，长消息折叠（>2000 字显示"展开"），截断时顶部提示"仅显示开头 200 条与最近 1800 条"；提供"原始记录"切换查看旧 `<pre>`。纯文本渲染。
- [ ] 测试：渲染、角色样式、折叠、回退到原文、`<script>` 以文本显示。
- [ ] 实现 → `npm test`、`npx tsc --noEmit`、oxlint → Commit `feat(webuddy-server): 会话详情按对话显示`

### Task 8: 文档与弃用
**Files:** `tools/webuddy-agent/README.md`（新数据流、支持的 agent 列表、旧 scan 弃用）；`tools/webuddy-server/README.md`（conversation 字段）；新建 `tools/webuddy-server/docs/ssh-collection-phase2.md`（SSH 二期设计：relay `conversation` RPC 需能力协商、`unverifiable` 处理、relPath 加执行主机前缀）。
- [ ] Commit `docs(webuddy): 全 agent 采集说明与 SSH 二期设计`
