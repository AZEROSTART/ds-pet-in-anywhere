# 桥协议 v1（OpenCode → 宠物守护进程）

插件与守护进程之间的唯一接口。**协议版本独立于应用版本**：`protocol` 不等时守护进程直接拒收，
避免半懂不懂的事件把宠物状态弄乱。

- 版本规则：只有**不向后兼容**的改动才升版本。新增事件名、可选字段直接进 `1`——老宿主会忽略
  不认识的 `type` / 字段，所以升级顺序不会让宠物整体哑掉。
- 代码：`src/bridge/protocol.ts`（类型）、`src/bridge/routes.ts`（HTTP 边界）、
  `src/bridge/translate.ts`（翻译）、`src/bridge/link.ts`（状态机）、`plugin/src/normalize.ts`（归一化）

## 传输

| 项   | 值                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------- |
| 地址 | `POST http://127.0.0.1:<port>/dsh-pet-7340/opencode-pet/bridge/v1/{hello,events,bye}`              |
| 发现 | `~/.opencode-pet/runtime.json`（0600）：`{ name, version, pid, port, token, protocol, startedAt }` |
| 鉴权 | 请求头 `x-dsh-pet-token: <token>`；只绑回环，Host 必须是 `127.0.0.1:<port>` / `localhost:<port>`   |
| 来源 | 拒绝带 `Origin`（非本机同源）或 `sec-fetch-site: cross-site` 的请求                                |
| 正文 | `application/json`，单次 ≤ **256 KB**                                                              |
| 失败 | 插件丢弃本批事件并静默重试；**绝不阻塞 OpenCode**                                                  |

`runtime.json` 在每次守护进程启动时重写（新端口、新令牌）。插件连续 3 次请求失败后重读它，
因此宠物重启不需要重启 OpenCode。

## 请求体

```jsonc
// POST …/hello —— 连接建立时发一次，携带会话标题/父子关系快照
{ "protocol": 1, "pluginVersion": "0.1.0", "sessions": [{ "id": "ses_…", "title": "…", "parentID": null }] }

// POST …/events —— 事件（或空数组的心跳）
{ "protocol": 1, "events": [{ "id": "evt_…", "type": "session.tool.called", "sessionID": "ses_…", "at": 1762848000000, "data": {} }] }

// POST …/bye —— 插件卸载时尽力而为
{ "protocol": 1 }
```

事件对象：

| 字段           | 必填 | 说明                                                  |
| -------------- | ---- | ----------------------------------------------------- |
| `id`           | ✅   | OpenCode 事件 id，宿主用它去重（保留最近 1000 个）    |
| `type`         | ✅   | 见下表；未知值忽略                                    |
| `sessionID`    | ✅   | 会话 id                                               |
| `at`           | ✅   | 事件时间（ms）                                        |
| `sessionTitle` | —    | 会话标题，用于通知文案                                |
| `parentID`     | —    | 非空表示子代理会话（不弹完成通知）                    |
| `seq`          | —    | OpenCode 的 `durable.seq`：同档位「谁更近」的排序依据 |
| `data`         | —    | 只带宠物需要的字段，**不要转发完整消息体/工具 input** |

## 事件与翻译

插件先归一化（`plugin/src/normalize.ts`），宿主再把桥事件翻成 dsh-pet 内部已有的 DSH 事件形状
（`src/bridge/translate.ts`），喂给上游 reducer：

| 桥事件                          | DSH 事件                 | 工作状态                | 归一化来源（OpenCode 2.2.7）                                                                       |
| ------------------------------- | ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `session.execution.started`     | `turn/start`             | `thinking`              | 同                                                                                                 |
| `session.execution.succeeded`   | `turn/end` completed     | `success`               | 同                                                                                                 |
| `session.execution.failed`      | `turn/end` error         | `error`                 | 同（带 `error`）                                                                                   |
| `session.execution.interrupted` | `turn/end` aborted       | 空闲                    | 同                                                                                                 |
| `session.idle`                  | `turn/end` idle          | 空闲                    | 同（兜底）                                                                                         |
| `session.tool.called`           | `tool/call`              | `working`               | 工具名取自 `session.tool.input.started`（按 `sessionID+callID` 缓存），`called` 本身不转发 `input` |
| `session.tool.success`          | `tool/result`            | `result`                | 同（`isError: false`）                                                                             |
| `session.tool.failed`           | `tool/result`            | `result` → 可能 `error` | 同（`isError: true`）                                                                              |
| `permission.asked`              | `approval/asked`         | `waiting`               | 同（`action` → `toolName`，`message` → `reason`）                                                  |
| `permission.replied`            | `approval/replied`       | `working`               | 同                                                                                                 |
| `session.text.ended`            | `assistant/message`      | —                       | 同（只取 `ended`，不转发 `delta`）                                                                 |
| `user.message`                  | `user/message`           | —（只设焦点）           | `session.inbox.enqueued` 且 `item.type === 'user'`                                                 |
| `session.meta`                  | —（只更新标题/父子关系） | —                       | `session.created` / `session.renamed`                                                              |

被丢弃的：所有 `*.delta`、`session.usage.updated`、`session.step.*`、`session.tool.progress`、
`session.reasoning.*`，以及 `agent/model/plugin/project/mcp/shell/filesystem` 等全局域事件。

## 连接状态机（宿主侧）

| 时机                    | 行为                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| `hello` / `events` 到达 | 标记已连接，刷新 `lastSeenAt`                                     |
| 每 5s 空 `events`       | 心跳；插件侧 `setInterval` 发空数组                               |
| 15s 无心跳              | 视为断开：对每个 active 会话补一条 `turn/end` aborted，宠物回空闲 |
| `bye`                   | 清空 active 并各自补 `turn/end` aborted                           |
| 任一会话产生状态事件    | 加入 active（不只是 `turn/start`，否则中途接入的会话清不掉）      |

## 焦点：宠物展示哪个会话

展示槽只有一个，规则按优先级从上到下：

1. 收到 `user.message` 且会话不是子代理 → 把展示锁定到该会话；
2. 焦点会话没有活动条目（回合结束）→ 空闲，**不回落**其它会话；
3. 还没有焦点（刚启动）→ 全局优先级 `waiting > error > working > thinking > result > success`，
   同档取 `seq` 更大者。

`session.inbox.enqueued` 里 `item.type === 'synthetic'`（自动续跑）与子代理转发的提示词**不算**
用户操作，不会改焦点。焦点只存在内存里，宠物重启后等你的下一条消息。
