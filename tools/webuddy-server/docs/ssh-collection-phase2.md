# SSH 远端会话采集（二期设计，未实现）

本期（见 `tools/webuddy-agent/README.md`、`AGENTS.md` 里的 all-agents 采集计划）只采集**本机**（含本机 WSL）的 AI Vault 会话：`listAiVaultSessions({ unlimited: true })` 只扫描本地磁盘，SSH 远端主机上跑的会话不会出现在 `scan --manifest` 的 manifest 里，因此也不会进入采集流水线。本文档记录二期把 SSH 远端会话纳入采集时要遵守的设计约束，供后续实现参考——现在还没有任何代码实现这里描述的内容。

## 为什么不能直接扩到远端

Orca 的远端连接模型见 `docs/reference/ssh-execution-boundary.md`：**执行主机拥有一切与执行相关的状态**（工具、凭据、身份、环境、进程、产物），客户端只负责 UI、传输和控制面状态，对执行状态没有权威性。这条规则对采集意味着：

- 不能"客户端本地跑一遍扫描逻辑假装是远端结果"——远端会话文件在远端主机上，必须由远端（或经由 relay 到达远端）读取，而不是本机随便猜一个路径去读。
- 连不上远端主机，绝不能等价于"远端没有这个会话"或"远端会话已经结束"。

## RPC 必须能力协商

远端会话的对话读取（`conversation` 操作，仿本机 `firstPrompt`/`session-scanner-service-entry.ts`）如果要经 relay 转发到 SSH 主机执行，新增的 relay RPC（例如 `conversation` 操作本身，或专门的一个 `ssh.readVaultConversation` 之类的 opcode/方法）必须按 `docs/reference/remote-wire-compatibility.md` 的规则协商：

- 如果只是给已有帧加一个新的**可选字段**（Rule 1），老端点会忽略未知字段，天然兼容，不需要协商。
- 如果是新增一个**stream opcode** 或一个新 RPC 方法本身（Rule 2），必须在握手阶段协商能力：客户端在 `Subscribe`/握手帧里声明支持，relay/远端在响应里回显确认，客户端确认收到回显后才发送新方法调用；老版本 relay 收到未知 opcode 会静默丢帧，调用方永远等不到响应，所以绝不能无协商直接发。参考现有 `SetOutputPaused`（opcode 16）的协商模式。
- 如果 host 端开始发布/停止发布某个字段、或改变某个已有字段的含义（Rule 3），即使帧格式没变也要按能力位门控，否则老客户端会读到含义变了的同一字段。

结论：**二期新增的 `conversation` RPC 必须走能力协商，不能假设配对的另一端已经升级。**

## 连不上远端主机的会话状态

`docs/reference/ssh-execution-boundary.md` 规定的进程状态词表是封闭的三态：`live` / `unverifiable` / `exited`，不允许引入同义词，也不允许把 `unverifiable` 收进另外两者。采集器读取远端会话列表/对话内容时如果连不上主机（网络问题、relay 未部署、认证失效等），必须：

- 把这一批会话标记为 `unverifiable`（这一轮采不到，下一轮再试），**绝不能**因为连不上就认为"这个远端会话已经不存在了"而把它从游标里抹掉，也不能把它上报成"已结束"。
- 只有远端主机明确返回"这个会话/文件不存在"这种带证据的结果时，才可以按"没有这个会话"处理；单纯的超时、连接被拒、进程未响应都只是 `unverifiable`。
- 这条规则不仅约束会话是否存在的判断，也约束采集器自身的重试/退避逻辑：`unverifiable` 应该触发退避重试，而不是触发游标前移或清理。

## `relPath` 加执行主机前缀

本机（含本机 WSL）会话的 `relPath` 是相对 home 目录的相对路径（本机是裸路径，WSL 会话前缀 `wsl:<distro>/…`，见 `tools/webuddy-agent/lib/collectors.mjs:222` 和 `src/main/webuddy/vault-session-manifest.ts`）。SSH 远端会话必须再加一层执行主机前缀，避免不同主机上恰好同名的相对路径互相覆盖/去重错乱：

```
ssh:<host>/<relative-path-on-that-host>
```

- `<host>` 用能稳定标识该 SSH 目标的 id（不是每次连接可能变化的展示名），与 `ExecutionHostId` 的既有约定对齐（`src/shared/execution-host.ts`）。
- 这个前缀本身就是去重 key 的一部分：同一个远端主机、同一个相对路径才算同一个会话；换了主机 id（比如重装或换了别名）会被当成新会话，这是有意的——见下面「游标按主机分区」。
- `transcript.path`（脱敏后的 cwd/文件路径）仍然只脱敏该主机自己的 home 目录，不与本机的 home 混淆。

## 游标按主机分区（cursor keyed per host）

本机游标（`~/.webuddy-agent/vault-cursor.json`，键 `agent\0filePath\0sessionId`）不能直接套用到多个执行主机：同一个 `filePath` 在主机 A 和主机 B 上可能是完全不相关的两个文件。二期游标必须在键里再加一层执行主机 id：

```
<executionHostId>\0<agent>\0<filePath>\0<sessionId>
```

- 每个远端主机的增量状态独立维护，一个主机连不上不影响其它主机的游标继续前移。
- 主机变得 `unverifiable` 时，只暂停该主机的游标前移，不清空、不合并到别的主机。
- 主机被移除（用户明确操作，而不是连接失败）才清理该主机在游标里的条目，且清理动作要和 `docs/reference/ssh-execution-boundary.md` 里"host-acknowledged explicit user action"的口径一致——被动失联不算"移除"。

## 小结：二期要做什么、暂时不做什么

- 要做：远端会话列表/对话读取走能力协商过的 RPC；远端不可达按 `unverifiable` 处理并退避重试，不误判为会话消失；`relPath` 加 `ssh:<host>/` 前缀参与去重；游标按执行主机分区。
- 暂时不做（本期范围）：任何 SSH 远端会话的实际采集代码。本文档只是设计约束，落地时机由后续任务决定。
