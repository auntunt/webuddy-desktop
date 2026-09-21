# webuddy-agent — 开发过程数据采集

把本机 Claude Code / Codex / OpenCode 的会话记录，规范成**带归属、带日期、带 agent 信息**的结构化记录，落盘到 outbox，再由 `push` 送到公司服务端，形成公司数据资产。

设计前提：**现在还没全走中转站**，日志散在各人独立的订阅客户端里，所以采集发生在本地。

---

## 一、记录规范：一条记录回答三个问题

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
| `session.localDate` | **本地日历日**（`YYYY-MM-DD`）。日报/周报/留存都按本地日切，不按 UTC |
| `collectedAt` | 采集时刻，与会话时间区分开 |

### 3. 哪个 agent（claude / codex / …）

| 字段 | 说明 |
|---|---|
| `agent.id` | 稳定枚举：`claude-code` / `codex` / `opencode` |
| `agent.label` | 展示名 |
| `agent.version` | 该 CLI 自身版本（Claude 取 `version`，Codex 取 `cli_version`） |
| `agent.model` | 会话中使用/指定的模型，未暴露则为 `null` |
| `session.turnCount` | 人类发起的轮次 |
| `session.messageCount` | user/assistant 消息数 |
| `session.tokens` | `{input, output, total}`，agent 未提供则为 `null` |

> `null` 的语义是**该 agent 没暴露**，不是"实际为空"。下游不要用 `null` 推断事实。

### 其它字段

- `workspace.cwd`（家目录已脱敏为 `~`）、`branch`、`repo`
- `transcript.path` / `relPath` / `bytes` / **`sha256`** / `format`
- `redaction.policyVersion` / `rulesApplied[]` / `transcriptTruncated`
- `consent.scope`
- `schema`：`webuddy.agent-session.v1`

---

## 二、两级授权

| scope | 上传内容 | 默认 |
|---|---|---|
| `transcript-metadata` | 仅元数据 + 哈希，**任何消息正文都不出本机** | ✅ |
| `transcript-full` | 元数据 + 脱敏后的原始 transcript | 关 |

正文永远先过脱敏：密钥、token、私钥块、URL 内嵌口令会被替换为 `[redacted:<规则名>]`；家目录路径在所有 scope 下都脱敏。

---

## 三、命令

```bash
node tools/webuddy-agent/index.mjs status          # 当前身份、授权、游标、队列
node tools/webuddy-agent/index.mjs scan            # 采集并写入 outbox
node tools/webuddy-agent/index.mjs scan --json     # 额外把记录打到 stdout
node tools/webuddy-agent/index.mjs scan --force    # 忽略游标，重采
node tools/webuddy-agent/index.mjs scan --full     # 本次按 transcript-full 采集
node tools/webuddy-agent/index.mjs push            # 推送 outbox
node tools/webuddy-agent/index.mjs config show
node tools/webuddy-agent/index.mjs config set userId=lina
node tools/webuddy-agent/index.mjs config set endpoint=https://ingest.cloudwaveai.cn/v1/sessions
```

配置：`~/.webuddy-agent/config.json`（0600）。可用环境变量覆盖：`WEBUDDY_USER_ID` / `WEBUDDY_ENDPOINT` / `WEBUDDY_TOKEN` / `WEBUDDY_CONSENT_SCOPE` / `WEBUDDY_HOME` / `WEBUDDY_AGENT_HOME`。

## 四、增量与可靠性

- 游标按**文件绝对路径 + 内容 sha256** 记录，内容没变不重复采集（append-only 日志天然适合）
- 记录**先落盘再入队**，推送失败/离线不丢数据，下次自动重试
- 单次推送最多 50 条一批；失败累计 25 次后标记 `exhausted`，`status` 可见原因，不静默吞掉
- 推送前做 schema 校验，不合规记录不会上线

## 五、上传协议

```
POST <endpoint>
Authorization: Bearer <token>
X-Webuddy-Device-Id: <deviceId>

{
  "schemaVersion": "webuddy.batch.v1",
  "records": [ { "record": {...}, "transcript": "<仅 full scope>" } ]
}
```

## 六、已知边界

- 正文采集目前只支持 UTF-8 文本 JSONL；其它格式只采元数据
- 单文件超过 `maxTranscriptBytes`（默认 32 MiB）会截断，并在 `redaction.transcriptTruncated` 标出
- 采集的是**本地已有**的会话文件；不拦截网络、不注入 agent 进程
