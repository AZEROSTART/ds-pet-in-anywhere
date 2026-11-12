# 文档

实现过程中留下的判断与事实。**代码是唯一权威**：这里解释「为什么是这样」，不保证每个字段与
当前实现逐字对应（差异集中在 `design.md` 文末）。

| 文档                                                 | 内容                                                                                                                                  | 什么时候看                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [design.md](design.md)                               | 设计基线：为什么是独立进程、为什么 fork upstream 的 standalone 模式、协议/窗口/自启/安全/测试策略、风险；文末列出**实现与设计的差异** | 想改架构、或想知道某个看似别扭的决定从哪来   |
| [bridge-protocol.md](bridge-protocol.md)             | 桥协议 v1 的准确参考：端点、鉴权、事件表、翻译、连接状态机、焦点规则                                                                  | 改插件、改桥、或从别的工具往宠物推状态       |
| [opencode-2.2.7-events.md](opencode-2.2.7-events.md) | 对 OpenCode 2.2.7 的事件探针结论：事件形状、关键子集、哪些信号能当焦点                                                                | 升级 OpenCode 版本前对照；排查「状态对不上」 |
| [implementation-plan.md](implementation-plan.md)     | 实施计划（已完成）：10 个 task 的拆解、验收点与自检记录                                                                               | 想按原顺序重放某个环节，或看当时怎么切任务   |
| [images/hero.png](images/hero.png)                   | README 头图                                                                                                                           | —                                            |

## 时间线

1. **2026-11-11**：探针确认 2.2.7 的插件 API 与事件形状（`opencode-2.2.7-events.md` 前半）。
2. 按 `implementation-plan.md` 的 Task 0–9 实现：fork → 改名/数据目录 → 独立模式事件 hub →
   桥协议/翻译 → 运行时文件与路由 → 状态机 → OpenCode 插件 → launchd → 打包与文档。
3. **2026-11-12**：修「多会话抢镜」——引入焦点会话（用户消息锁定）、透传 `durable.seq`、
   让中途接入的会话也能被清理（`design.md` 第 16 节、`bridge-protocol.md` 末节）。
4. 重写 README（中英双语）、公开仓库。

## 排查顺序（状态不对时）

1. `opencode plugin list` 有没有 `opencode-pet`；
2. `~/.opencode-pet/runtime.json` 是否存在、端口与令牌是否匹配当前进程；
3. `curl …/dsh-pet-7340/state` 看 `sections.workStatus.data`（`state` / `sessionId` / `task`）；
4. `~/.opencode-pet/dsh-pet/logs.txt` 里搜 `workStatus pet=` 看渲染端实际播了哪一档动画；
5. 仍不对：`OPENCODE_PET_BRIDGE_DEBUG=1` 前台跑一次，看桥有没有收到事件。
