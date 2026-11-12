# OpenCode 2.2.7 插件探针笔记

日期：2026-11-11
方式：`opencode-new run "say hi in one word"` + `~/.config/opencode/plugin/opencode-pet-probe.ts`
探针把事件写到 `/tmp/opencode-pet-probe.log`。

## 安装方式（已验证）

- 插件目录：`~/.config/opencode/plugin/` 或 `~/.config/opencode/plugins/`。
- 单文件 `.ts` 可直接放进去，无需构建；`opencode plugin list` 能看到：

```
ID                  VERSION  SOURCE
opencode-pet-probe  local    ~/.config/opencode/plugin/opencode-pet-probe.ts
```

- 目录形式也可（`plugins/paseo-managed-bridge/server.js` 已验证被加载）。
- `plugin` 与 `plugins` 两个目录都会被扫描（`packages/core/src/plugin/source-directory.ts`）。

## 事件形状

顶层：

```json
{
  "id": "evt_...",
  "created": 1794398981595,
  "type": "session.execution.started",
  "durable": { "aggregateID": "ses_...", "seq": 2, "version": 1 },
  "location": { "directory": "/path/to/worktree" },
  "data": { "sessionID": "ses_..." }
}
```

- 业务字段在 `event.data`，不是顶层。
- `location.directory` 可用于区分工作区。
- `ctx.event.subscribe()` 返回 `AsyncIterable<SelectedEvent>`；`for await` 直接拿。
- **插件会收到服务器上所有会话的事件**，包括其它窗口/工作区（探针里看到了 `hover-glossary` 等无关会话）。最终插件要么全收，要么按“当前打开标签/最近活动”过滤。

## 观察到的 35 种事件（关键子集）

| type                                                                                                                                            | data 关键字段                                                | 用途                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------- |
| `session.created`                                                                                                                               | `sessionID`, `projectID`, `slug`, `parentID?`, `version`     | 新会话；标题可能还没有    |
| `session.renamed`                                                                                                                               | `sessionID`, `title`                                         | 标题来源                  |
| `session.execution.started`                                                                                                                     | `sessionID`                                                  | turn 开始 → thinking      |
| `session.execution.succeeded`                                                                                                                   | `sessionID`                                                  | turn 成功 → success       |
| `session.execution.failed`                                                                                                                      | `sessionID`, `error`                                         | turn 失败 → error         |
| `session.execution.interrupted`                                                                                                                 | `sessionID`, `reason`（user/shutdown/superseded/inactivity） | 中止 → idle               |
| `session.reasoning.started/ended`                                                                                                               | `sessionID`, `assistantMessageID`, `ordinal`, `text`(ended)  | 思考                      |
| `session.text.started/delta/ended`                                                                                                              | `sessionID`, `assistantMessageID`, `ordinal`, `text`(ended)  | 回复正文；只取 `ended`    |
| `session.tool.input.started`                                                                                                                    | `sessionID`, `assistantMessageID`, `id`, `name`              | 工具名 → 气泡任务         |
| `session.tool.called`                                                                                                                           | `sessionID`, `assistantMessageID`, `id`, `input`, `executed` | 工具开始 → working        |
| `session.tool.progress`                                                                                                                         | `sessionID`, `id`, `metadata`                                | 进度（可忽略）            |
| `session.tool.success`                                                                                                                          | `sessionID`, `id`, `content`, `metadata`, `executed`         | 工具成功 → result         |
| `session.tool.failed`                                                                                                                           | `sessionID`, `id`, `error`, `content`, `executed`            | 工具失败 → result + error |
| `permission.asked`                                                                                                                              | `sessionID`, `id`, `action`, `resources`, `message?`         | 等待确认 → waiting        |
| `permission.replied`                                                                                                                            | `sessionID`, `requestID`, `reply`                            | 回到工作                  |
| `session.idle`（deprecated，仍出现）                                                                                                            | `sessionID`                                                  | 兜底空闲                  |
| `session.status`（deprecated）                                                                                                                  | `sessionID`, `status`                                        | 兜底状态                  |
| `session.inbox.enqueued/delivered`                                                                                                              | `sessionID`, ...                                             | 排队输入（可忽略）        |
| `session.instructions.updated`                                                                                                                  | `sessionID`, `delta`                                         | 可忽略                    |
| `session.step.started/streamed/ended`                                                                                                           | `sessionID`, ...                                             | 可忽略                    |
| `session.usage.updated`                                                                                                                         | `sessionID`, ...                                             | 可忽略                    |
| 全局域事件 `agent.updated` / `model.updated` / `plugin.updated` / `mcp.*` / `project.updated` / `worktree.*` / `shell.*` / `filesystem.changed` | —                                                            | 宠物不关心，忽略          |

## 关键结论

1. `session.tool.input.started` 的 `name` 是工具名；`session.tool.called` 的 `id` 是调用 id。两者需要按 `sessionID + id` 关联，才能给气泡带工具名。
2. `session.tool.called` 的 `input` 可能很大（diff 内容），插件归一化时**不要转发 input**。
3. `session.text.ended` 带完整文本，适合做通知正文；`delta` 不要转发。
4. 发事件前不需要查会话列表；`session.created`/`renamed` 足够维护标题。`ctx.session.list()` 也能 seed，但要以实际返回字段为准。
5. 插件 `setup` 会被调用多次（探针出现 5 次 `plugin loaded`）。最终插件必须容忍重复实例：每个实例独立订阅，但不能重复写文件/重复心跳造成副作用。
6. 2.2.7 二进制在 `~/.opencode/bin/opencode-new`；`~/.opencode/bin/opencode` 仍是 2.1.3，因为原地覆盖运行中的二进制会让新进程被 SIGKILL。会话结束后用 `mv` 交换，不要用 `cp` 覆盖。

## 上线后补测：哪个信号能当「焦点」

第一版按全局优先级展示（多会话时取最忙的那个），现场表现是「宠物在动，但看不出在忙」。
逐层取证后确认：同时 3 个会话在跑，展示槽 20 秒内换了 3 个会话、切了 34 次，动画每次从第 0 帧重播。
于是回头测了三个候选焦点信号：

| 候选                                              | 实测                                                           | 结论                                         |
| ------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| `session.viewed`                                  | 一天 81 次，**全部**指向同一个后台会话（`ses_e5555d8deff…`）   | 不能用：会把焦点钉在后台会话上               |
| `session.inbox.enqueued` + `item.type === 'user'` | 用户亲手发消息时才出现；自动续跑是 `item.type === 'synthetic'` | **采用**：真正代表「我现在在这个会话里」     |
| 子代理会话的消息                                  | `header.origin === 'subagent'`，且提示词由父会话转发           | 不能当焦点：团队里一有成员跑起来宠物就会跳走 |

另外两条与排序/清理有关的事实：

- `durable.seq` 在 `event.durable.seq`（不是 `event.data`），同一会话内单调递增；丢掉它之后
  「同档位取最近」永远按 0 比较，僵尸条目会按插入顺序长期占位。
- 插件可能在**回合中途**才接上（只看到 `session.tool.called`，看不到 `session.execution.started`）。
  这类会话如果只按 `turn/start` 记进 active，就永远等不到 `turn/end`，断连也清不掉。
