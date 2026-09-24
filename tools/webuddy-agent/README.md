# webuddy-agent — 开发过程数据采集

把本机 coding agent 的会话记录，规范成**带归属、带日期、带 agent 信息**的结构化记录，落盘到 outbox，再由 `push` 送到公司服务端，形成公司数据资产。

设计前提：**现在还没全走中转站**，日志散在各人独立的订阅客户端里，所以采集发生在本地。

---

## 〇、数据流

Orca 桌面端（App）在后台驱动采集，命令行本身只是被调用的执行体：

```
App（AI Vault 扫描 + 游标）
  → 导出变化会话到一份 manifest.jsonl（每行一条 WebuddyManifestEntry）
  → 调 `webuddy-agent scan --manifest <file>`（本 CLI，把每行转成规范记录、脱敏、写 outbox）
  → 调 `webuddy-agent push`（把 outbox 推给服务端）
```

- **AI Vault** 是 App 里统一的多 agent 会话索引（`listAiVaultSessions`），已经在后台低优先级子进程里扫描过全部支持的 agent，含 Windows 上的 WSL 路径。App 侧按游标（`~/.webuddy-agent/vault-cursor.json`）只导出变化过的会话，每轮最多 200 个，按最新优先，写不下的留到下一轮。
- 本 CLI 不再自己去发现/解析各 agent 的会话文件——那一层已经在 AI Vault 里做过一次；`scan --manifest` 只做 App 已经收集齐的条目 → 记录（record）+ 脱敏 + 落盘这一步，逻辑在 `lib/manifest.mjs`。
- `scan --manifest` 成功（退出码 0）后，App 才会把这一轮的游标前移；不成功就整轮重试，不会丢会话。

## 一、支持的 agent（18 个）

来自 `src/shared/ai-vault-types.ts` 的 `AI_VAULT_AGENTS` / `AI_VAULT_AGENT_LABELS`：

| agent id（AI Vault） | 采集记录里的 `agent.id` | 展示名 |
|---|---|---|
| `claude` | `claude-code`（去重兼容旧数据，唯一改名的一项） | Claude Code |
| `codex` | `codex` | Codex |
| `hermes` | `hermes` | Hermes |
| `pi` | `pi` | Pi |
| `omp` | `omp` | OMP |
| `prime-agent` | `prime-agent` | Prime Agent |
| `cursor` | `cursor` | Cursor |
| `gemini` | `gemini` | Gemini |
| `antigravity` | `antigravity` | Antigravity |
| `rovo` | `rovo` | Rovo Dev |
| `copilot` | `copilot` | GitHub Copilot |
| `opencode` | `opencode` | OpenCode |
| `grok` | `grok` | Grok |
| `openclaw` | `openclaw` | OpenClaw |
| `devin` | `devin` | Devin |
| `droid` | `droid` | Droid |
| `cline` | `cline` | Cline |
| `kimi` | `kimi` | Kimi |

其余 17 个 agent id 原样透传，只有 `claude` 在记录里改叫 `claude-code`（与旧版采集器已经上传的历史数据对齐，避免同一份会话在服务端出现两条）。

## 二、记录规范：一条记录回答三个问题

### 1. 谁的日志（归属）

| 字段 | 说明 |
|---|---|
| `actor.userId` | **必填**。谁产生的工作。未配置时采集直接报错，不做匿名上传 |
| `actor.deviceId` | 本机唯一 ID，首次运行生成后固定，换机器不变、改名不变 |
| `actor.deviceLabel` / `hostname` | 人可读的机器标识 |
| `actor.osUser` / `platform` | 系统账号与操作系统 |

### 2. 什么时候（日期）

| 字段 | 说明 |
|---|---|
| `session.startedAt` | 会话**最早**一条事件时间（ISO 8601，带时区） |
| `session.endedAt` | 会话**最晚**一条事件时间 |
| `session.durationMs` | 时长 |
| `session.localDate` | **本地日历日**（`YYYY-MM-DD`）。按系统时区用 `Intl.DateTimeFormat('en-CA', { timeZone })` 计算（跨夏令时也准），日报/周报/留存都按本地日切，不按 UTC |
| `collectedAt` | 采集时刻，与会话时间区分开 |

### 3. 哪个 agent

| 字段 | 说明 |
|---|---|
| `agent.id` | 见上表；claude→`claude-code`，其余原样 |
| `agent.label` | 展示名 |
| `agent.version` | 走 `scan --manifest` 时固定为 `null`（AI Vault 侧未采集 CLI 自身版本） |
| `agent.model` | 会话中使用/指定的模型，未暴露则为 `null` |
| `session.turnCount` | 人类发起的轮次 |
| `session.messageCount` | user/assistant 消息数 |
| `session.tokens` | `{input, output, total}`，`input`/`output` 恒为 `null`，`total` 取 AI Vault 汇总的 token 数（无则 `null`） |

> `null` 的语义是**该 agent 没暴露**，不是"实际为空"。下游不要用 `null` 推断事实。

### 其它字段

- `workspace.cwd`（家目录已脱敏为 `~`；WSL 会话脱敏 `/home/<u>` 等 WSL 内部路径）、`branch`、`repo`（`scan --manifest` 下恒为 `null`）
- `transcript.path` / `relPath` / `bytes` / **`sha256`** / `format`
- `redaction.policyVersion` / `rulesApplied[]` / `transcriptTruncated`
- `consent.scope`
- `schema`：`webuddy.agent-session.v1`

---

## 三、两级授权

| scope | 上传内容 | 默认 |
|---|---|---|
| `transcript-metadata` | 仅元数据 + 哈希，**任何消息正文都不出本机** | ✅ |
| `transcript-full` | 元数据 + 脱敏后的原始 transcript | 关 |

正文永远先过脱敏：密钥、token、私钥块、URL 内嵌口令会被替换为 `[redacted:<规则名>]`；家目录路径在所有 scope 下都脱敏。

---

## 四、命令

### `scan --manifest`（App 使用，推荐）

```bash
node tools/webuddy-agent/index.mjs scan --manifest <manifest.jsonl> [--json] [--force]
```

- `<manifest.jsonl>` 每行一个 JSON 对象（`WebuddyManifestEntry`，定义见 `src/main/webuddy/vault-session-manifest.ts`），由 App 从 AI Vault 生成，本 CLI 只读不生成。
- 每行两种 `transcriptFormat`：
  - `raw-file`：会话本身就是一份 `.jsonl`/`.json` 原始文件，`scan` 会读文件、算 sha256、脱敏后整篇作为 `transcript` 正文发送（与旧版行为一致）。
  - `webuddy.conversation.v1`：数据库型 agent（OpenCode 的 SQLite、Devin、Cursor 等非文件行）没有单一原始文件，`transcript` 正文改成脱敏后的规范化对话 JSONL（`{role,text,timestamp}` 逐行），sha256/bytes 按这段文本算。
- 处理完成后，stdout 打印一行 JSON 摘要：`{"emitted": N, "skipped": N, "invalid": N, "unreadable": N}`。
  - `emitted`：新写入 outbox 的记录数。
  - `skipped`：内容未变（游标命中）+ 不在配置的 workspace 范围内。
  - `invalid`：manifest 行本身格式错（不是 JSON / 缺必填字段 / `transcriptFormat` 不认识）。
  - `unreadable`：条目本身没问题，但对应文件读不到（已消失、无权限等）。
- **退出码契约**：`invalid`/`unreadable` 都是"这一条跳过"，不影响整轮成功——只要 manifest 文件本身能打开、outbox 能写、游标能保存，退出码就是 `0`。只有整轮级别的失败（manifest 文件打不开、outbox 写失败、游标写失败）才会让进程以非 0 退出；`--manifest` 后缺参数或跟了另一个 `--flag` 退出码是 `2`（用法错误）。App 只在退出码为 `0` 时才把本轮游标前移，这样一批坏行不会拖住整批好行，也不会因为偶发单条失败而重复重发已经成功的部分。
- 会话的对话正文永远随记录一起发送（脱敏后），不是可选授权项——`transcript-metadata`/`transcript-full` 这两级授权仍然存在，但只影响是否额外发送 `conversation` 字段（见下）。

### conversation 字段

`scan --manifest` 处理的记录，在旧的 `transcript` 之外，额外携带一个同级可选字段 `conversation`：

```jsonc
{
  "record": { /* 同旧版结构 */ },
  "transcript": "<脱敏后的正文，raw-file 是原始文件，webuddy.conversation.v1 是对话 JSONL>",
  "conversation": [ { "role": "user", "text": "…", "timestamp": "2026-…" }, … ]
}
```

- 每条消息都已脱敏（整段文本过 `redactLine`，多行密钥块也能命中）。
- 为控制体积：保留最早 200 条 + 最近 1800 条，总字节数 ≤ 1MB，单条 ≤16KB；被截断时记录里 `transcript.conversationTruncated = true`。
- 只读旧协议（`payload.transcript`）的老服务端会直接忽略这个多出来的字段，线兼容。
- 一条会话第一次带上 `conversation` 会被发送一次即使内容 sha256 没变（游标里记 `conversationSent`），用来回填旧版 `scan` 已经上传过、但当时还没有 `conversation` 的会话；之后再变化才按 sha256 正常判断要不要重发。

### 旧的发现式 `scan`（已弃用）

```bash
node tools/webuddy-agent/index.mjs scan            # 采集并写入 outbox
node tools/webuddy-agent/index.mjs scan --json     # 额外把记录打到 stdout
node tools/webuddy-agent/index.mjs scan --force    # 忽略游标，重采
node tools/webuddy-agent/index.mjs scan --full     # 本次按 transcript-full 采集
```

不带 `--manifest` 的 `scan` 是旧的发现式扫描（自己遍历 Claude Code / Codex / OpenCode 的会话目录），App 已经不再调用它。运行时会在 stderr 打印一行弃用提示。**只保留给不接入 App、直接用命令行的用户**（例如在 CI 或只装了 CLI 的机器上单独采集），只覆盖这 3 个 agent，不会随 AI Vault 一起扩展到全部 18 个 agent。计划在后续版本移除；新的集成一律使用 `scan --manifest`。

### 其它命令

```bash
node tools/webuddy-agent/index.mjs status          # 当前身份、授权、游标、队列
node tools/webuddy-agent/index.mjs push            # 推送 outbox
node tools/webuddy-agent/index.mjs config show
node tools/webuddy-agent/index.mjs config set userId=lina
node tools/webuddy-agent/index.mjs config set endpoint=https://ingest.cloudwaveai.cn/v1/sessions
```

配置：`~/.webuddy-agent/config.json`（0600）。可用环境变量覆盖：`WEBUDDY_USER_ID` / `WEBUDDY_ENDPOINT` / `WEBUDDY_TOKEN` / `WEBUDDY_CONSENT_SCOPE` / `WEBUDDY_HOME` / `WEBUDDY_AGENT_HOME`。

## 五、增量与可靠性

- `scan --manifest` 的游标是 App 侧的 `~/.webuddy-agent/vault-cursor.json`（按 agent/文件路径/sessionId 记录 `modifiedAt`/`updatedAt`/`messageCount`/`totalTokens`），只有变化过的会话才会出现在 manifest 里；本 CLI 自己的 `state.json`（按文件路径或 `relPath\0sessionId` + sha256）是第二道保险，内容 sha256 没变就跳过，即使 App 侧游标误判也不会重复上传。
- 旧的发现式 `scan` 仍按**文件绝对路径 + 内容 sha256** 记游标。
- 记录**先落盘再入队**，推送失败/离线不丢数据，下次自动重试。
- 单次推送最多 50 条一批；失败累计 25 次后标记 `exhausted`，`status` 可见原因，不静默吞掉。
- 推送前做 schema 校验，不合规记录不会上线。

## 六、上传协议

```
POST <endpoint>
Authorization: Bearer <token>
X-Webuddy-Device-Id: <deviceId>

{
  "schemaVersion": "webuddy.batch.v1",
  "records": [ { "record": {...}, "transcript": "<正文>", "conversation": [ /* 可选，见上 */ ] } ]
}
```

## 七、已知边界

- 正文采集目前只支持 UTF-8 文本 JSONL/JSON（`raw-file`）；数据库型 agent 走 `webuddy.conversation.v1` 走对话正文
- 单文件超过 `maxTranscriptBytes`（默认 32 MiB）会截断，并在 `redaction.transcriptTruncated` 标出
- 采集的是**本地已有**的会话文件；不拦截网络、不注入 agent 进程
- **SSH 远端主机的会话尚未采集**：AI Vault 目前只把本机（含本机 WSL）的会话计入 `scan --manifest` 的导出范围，跑在 SSH 远端主机上的会话不会出现在 manifest 里，也就不会被这条流水线采集到。远端采集的设计见 `tools/webuddy-server/docs/ssh-collection-phase2.md`（二期，未实现）。
