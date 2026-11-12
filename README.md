# ds-pet-in-anywhere

<img src="docs/images/hero.png" alt="ds-pet-in-anywhere — a transparent desktop pet on macOS that mirrors OpenCode sessions" width="100%" />

一只**住在桌面上**的透明宠物：常驻、置顶、点击穿透，跟着你的 OpenCode 会话状态活动
（思考 / 忙碌 / 整理 / 等待 / 成功 / 出错），OpenCode 关掉后继续待机。

_A transparent desktop pet that lives on your Mac and mirrors your OpenCode sessions.
It keeps living after OpenCode quits._

[中文](#中文) · [English](#english)

## 六档状态 / Six states

<img src="docs/images/states.png" alt="思考 / 忙碌 / 整理 / 等待确认 / 完成 / 出错 六档状态" width="100%" />

> 实机窗口截图（背景换成浅色便于看清）：档位由 OpenCode 事件驱动，气泡文案来自配置
> `workStatusTexts`，动画是逐帧 webm。
> _Real window captures, light backdrop added for legibility. States are driven by OpenCode events;
> bubble texts come from `workStatusTexts` in the config.*

---

## 中文

### 这是什么

一个**独立的常驻进程**，不是 OpenCode 的窗口内容，也不是 DSH 里的插件：

- 自己的 Electron 应用（`OpenCode Pet.app`），自己的一套本机 HTTP 服务；
- **唯一的**透明置顶层，切换应用/桌面/终端都不会消失；
- 由 **launchd** 托管：开机自启，崩了 10 秒内拉起，托盘可干净退出；
- OpenCode 只负责**喂事件**，两边通过本机 HTTP 桥连接，任一方不在都不影响另一方。

它不是「寄生在 DSH 里的桌宠」。与上游 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的关系是
**代码血缘**，不是运行依赖：

|                                            | dsh-pet（上游）         | 本仓库                                                                     |
| ------------------------------------------ | ----------------------- | -------------------------------------------------------------------------- |
| 宿主半侧（会话监听、状态聚合、HTTP、配置） | 跑在 **DSH 插件容器**里 | 跑在**自己的 Electron 主进程**里（`src/standalone/context.ts` 提供伪 ctx） |
| 窗口                                       | DSH 页面里的宠物        | 一个独立的透明置顶窗                                                       |
| 状态来源                                   | DSH 内部事件            | OpenCode server plugin 经本机 HTTP 桥推送                                  |
| 谁保证它活着                               | DSH                     | launchd（`KeepAlive`）                                                     |
| 需要 DSH 吗                                | 需要                    | **不需要**                                                                 |
| 需要 OpenCode 吗                           | —                       | 不需要也能待机；开着才联动                                                 |

也就是说：上游那套已经成熟的宿主逻辑、物理/动画、托盘、配置系统被**整体复用**，只是换了一个运行容器，
再用一条很薄的桥把 OpenCode 2.2.7 的会话事件接进来。运行期依赖里没有 DSH。
（`/dsh-pet-7340` 这类路由前缀和 `DSH_HOME` 回退是留下的兼容痕迹，改它们没有收益。）

### 架构

```
┌──────────────────────────────┐                     ┌────────────────────────────────┐
│ OpenCode server (2.2.7)      │   本机 HTTP 回环    │ opencode-pet.app (Electron)    │
│  └ plugin/  (server plugin)  │ ──────────────────▶ │  ├ 宿主半侧（dsh-pet 逻辑）    │
│      ctx.event.subscribe()   │  POST …/bridge/v1/  │  ├ 唯一透明置顶窗 + 桌宠渲染   │
│      归一化 + 批量推送        │  {hello,events,bye} │  ├ 本机 HTTP（/state 等）      │
└──────────────────────────────┘  X-DSH-Pet-Token    │  ├ 托盘                        │
                                                     │  └ launchd 托管 / 自启         │
                                                     └────────────────────────────────┘
```

- 桥的端口与令牌由守护进程写在 `~/.opencode-pet/runtime.json`（0600），插件每次重读。
- 插件每 **5 秒**发一次心跳（哪怕没有事件）；**15 秒**没心跳，宠物回空闲，不会永远卡在「工作中」。
- 插件侧失败一律丢弃并静默重试，**绝不阻塞 OpenCode**。
- 桥协议版本为 `1`：新增事件名 / 可选字段向后兼容，不升版本。

### 它跟哪个会话

宠物只有一个展示槽，所以必须选一个会话：

1. **你最近亲自发过消息的会话**（`session.inbox.enqueued` 且 `item.type === 'user'`）——锁定它。
   后台窗口、其它项目里同时跑着的会话不会抢走展示；
2. 子代理的提示词、自动续跑（`item.type === 'synthetic'`）**不算**你的操作，不会改焦点；
3. 还没收到过用户消息时（刚启动），退回「按优先级取最忙的一个」：
   `waiting > error > working > thinking > result > success`。

这条规则是为了修上线后实测到的问题：三个会话同时跑时，全局优先级会让宠物每几秒换一次会话、
动画每次从第 0 帧重播，看起来像根本没在忙。

### 环境要求

- macOS（Apple Silicon 构建并验证；Intel 未测），Electron 43
- OpenCode **2.2.7**（server plugin 的 `ctx.event.subscribe()` 按这个版本的事件形状实现）
- 开发：Node **>= 22.12**、npm、bun（构建插件用）
- 首次构建需要 Electron 解压目录（`npm run ensure:electron` 会放到 `~/.opencode-pet/electron`）

### 构建

```bash
npm install

# 插件（OpenCode 侧）
(cd plugin && bun run build)      # 产物 plugin/dist/server.js

# 宠物本体
npm run build:desktop-core        # runtime/electron-helper/shared-core.js（改了 src/shared 才需要重跑）
npm run bundle                    # lib/
npm run dist                      # 产物 dist-app/mac-arm64/OpenCode Pet.app
```

顺序是有依赖的：`build:desktop-core` → `bundle` → `dist`。漏了 `shared-core.js` 的表现是
**窗口在、但一片透明没画面**。

### 安装

```bash
cp -R "dist-app/mac-arm64/OpenCode Pet.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/OpenCode Pet.app"
open "/Applications/OpenCode Pet.app"
```

首次启动会：

1. 写 `~/Library/LaunchAgents/com.opencode.pet.plist`；
2. 交给 launchd 启动受监管的实例，当前进程退出；
3. 桌面右上角出现宠物，菜单栏出现托盘图标。

之后开机自启；进程被杀时 launchd 在 10 秒内拉起。

### 安装 OpenCode 插件

```bash
ln -s "$PWD/plugin" ~/.config/opencode/plugin/opencode-pet
opencode plugin list          # 应出现 opencode-pet  local
```

插件在 **OpenCode server 启动时**加载，所以要重启 OpenCode 才生效（重启的是 server，不是宠物；
宠物是独立进程）。插件找不到 `runtime.json` 时静默重试，不报错、不阻塞。

### 使用

- 拖拽 / 甩抛 / 双击弹弓 / 右键菜单 / 睡觉 / 待办：与上游 dsh-pet 一致。
- 右键首项：**打开 AI 设置**（本机设置页，带令牌的地址；余额、聊天、宠物配置都在里面）。
  不配也能用，工作状态联动不需要模型。
- 托盘：显示/隐藏宠物、**开机启动**（安装/移除 LaunchAgent）、**退出**（干净退出，launchd 不会拉起）。
- 数据与日志：`~/.opencode-pet/`
  - `runtime.json`：端口 + 令牌（0600）
  - `dsh-pet/logs.txt`：宿主、渲染端、桥的日志
  - `dsh-pet/main-config.jsonc`：用户配置（可选，覆盖 `assets/config.jsonc`）
  - `dsh-pet/standalone-ai.json`：AI 设置页保存的配置

### 开发

```bash
npm test                 # 宿主/共享层/node 侧，2510 个用例
npm run typecheck        # tsc --noEmit + 测试 tsconfig
(cd plugin && npm test && npm run typecheck)

npm run start:app        # 前台跑（OPENCODE_PET_NO_RELAUNCH=1，不走 launchd）
OPENCODE_PET_BRIDGE_DEBUG=1 npm run start:app   # 打桥的收发日志
DSH_PET_LOG_DEBUG=1 …                            # 更啰嗦的日志
```

关键目录：

| 路径                       | 作用                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `src/app/`                 | 应用入口：本机 HTTP、桥接线、launchd 托管、托盘                    |
| `src/standalone/`          | 伪 ctx（让上游宿主逻辑在 DSH 之外跑）、独立 HTTP、设置页           |
| `src/bridge/`              | 桥协议、事件翻译、状态机、路由、`runtime.json`                     |
| `src/host/`                | 上游宿主半侧：工作状态、通知、配置、素材解析、桌面 Helper 的宿主侧 |
| `src/shared/` / `runtime/` | 物理/动画/状态共享层与桌面 Helper（置顶窗、托盘、碰撞）            |
| `plugin/`                  | OpenCode 2.2.7 server plugin（订阅 → 归一化 → POST）               |
| `assets/`                  | webm 动画、字体、表情、音效、内置配置                              |

### 故障排查

| 现象                     | 处理                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 双击没反应               | `launchctl print gui/$(id -u)/com.opencode.pet` 看状态；确认 plist 里的 app 路径正确                                                                        |
| 只有透明窗、没画面       | `npm run build:desktop-core` 重跑一次，确认 `runtime/electron-helper/shared-core.js` 存在                                                                   |
| 宠物不动 / 一直空闲      | `opencode plugin list` 是否有 `opencode-pet`；`~/.opencode-pet/runtime.json` 是否存在；OpenCode 是否为 2.2.7                                                |
| 宠物跟着别人的会话跑     | 在你要跟的会话里发一条消息（焦点靠用户消息设定）；确认不是只有自动续跑                                                                                      |
| 想看此刻状态             | `curl -H "X-DSH-Pet-Token: $(jq -r .token ~/.opencode-pet/runtime.json)" "http://127.0.0.1:$(jq -r .port ~/.opencode-pet/runtime.json)/dsh-pet-7340/state"` |
| 首次打开被 Gatekeeper 拦 | 右键 → 打开，或执行上面的 `xattr`                                                                                                                           |

### 卸载

```bash
launchctl bootout "gui/$(id -u)/com.opencode.pet" 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.opencode.pet.plist
rm -rf "/Applications/OpenCode Pet.app"
rm -f ~/.config/opencode/plugin/opencode-pet
rm -rf ~/.opencode-pet        # 配置文件与日志，按需
```

### 已知限制

- 只打包 macOS **解包目录**（`mac:dir`），不出 dmg / zip，不签名不公证：自用安装即拷贝 `.app`。
- 取消勾选「开机启动」会顺带停掉当前宠物进程（下次启动才真正「不自启」）。
- 焦点会话只记在内存里：宠物重启后要等你下一条消息才重新锁定。
- 桥没有单批条数上限（只有 100ms 合批窗口）。
- 多显示器 / 混合 DPI 未做自动化验证。

### 文档

- [docs/design.md](docs/design.md)：设计基线（为什么是独立进程、为什么 fork upstream 的 standalone 模式），
  文末附**实现与设计的差异**
- [docs/bridge-protocol.md](docs/bridge-protocol.md)：桥协议 v1 的准确参考（端点、鉴权、事件表、焦点规则）
- [docs/opencode-2.2.7-events.md](docs/opencode-2.2.7-events.md)：2.2.7 事件探针结论，含「哪个信号能当焦点」
- [docs/implementation-plan.md](docs/implementation-plan.md)：实施计划（已完成，保留作变更记录）

### 授权

- **代码**：MIT（见 `LICENSE`），保留上游版权头。
- **动画 / 提示词 / 源视频**：CC BY-NC-SA 4.0，**非商业**；公开分发需署名并链接上游仓库，衍生素材同协议。
- 角色形象为社区二创（「大肥鱼 / 溟月」），非官方形象。

详见 `NOTICE`。

---

## English

### What it is

A **standalone resident process** — not a widget inside OpenCode, and not a plugin inside DSH:

- its own Electron app (`OpenCode Pet.app`) with its own loopback HTTP server;
- exactly **one** transparent, always-on-top window that survives app/desktop/terminal switches;
- supervised by **launchd**: starts at login, restarts within 10s if killed, clean quit from the tray;
- OpenCode only **feeds events** over a local bridge, so either side can live without the other.

It is _not_ the pet that lived inside DSH. It shares **code lineage** with upstream
[dsh-pet](https://github.com/PC2005-cloud/dsh-pet), not a runtime dependency:

|                                                   | dsh-pet (upstream)                 | this repo                                                                           |
| ------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| host half (session watching, state, HTTP, config) | runs in a **DSH plugin container** | runs in its **own Electron main process** (fake ctx in `src/standalone/context.ts`) |
| window                                            | pet inside a DSH page              | one standalone transparent always-on-top window                                     |
| state source                                      | DSH internal events                | OpenCode server plugin pushes over loopback HTTP                                    |
| kept alive by                                     | DSH                                | launchd (`KeepAlive`)                                                               |
| needs DSH                                         | yes                                | **no**                                                                              |
| needs OpenCode                                    | —                                  | no (idles); only links when OpenCode runs                                           |

The upstream host logic, physics/animation, tray and config system are reused wholesale; only the
container changed, plus a thin bridge for OpenCode 2.2.7 session events. DSH is not in the dependency
graph. (`/dsh-pet-7340` route prefixes and the `DSH_HOME` fallback are compatibility leftovers.)

### Architecture

```
┌──────────────────────────────┐                     ┌────────────────────────────────┐
│ OpenCode server (2.2.7)      │   loopback HTTP     │ opencode-pet.app (Electron)    │
│  └ plugin/  (server plugin)  │ ──────────────────▶ │  ├ host half (dsh-pet code)    │
│      ctx.event.subscribe()   │  POST …/bridge/v1/  │  ├ one transparent window      │
│      normalize + batch       │  {hello,events,bye} │  ├ loopback HTTP (/state, …)   │
└──────────────────────────────┘  X-DSH-Pet-Token    │  ├ tray                        │
                                                     │  └ launchd supervision         │
                                                     └────────────────────────────────┘
```

- Port and token are written by the daemon to `~/.opencode-pet/runtime.json` (0600); the plugin re-reads it.
- Plugin sends a heartbeat every **5s**; after **15s** without one the pet returns to idle instead of
  getting stuck in "working".
- Plugin failures are dropped silently; it **never blocks OpenCode**.
- Bridge protocol is `1`: new event names and optional fields stay backward compatible.

### Which session it follows

1. The session where **you last sent a message** (`session.inbox.enqueued` with
   `item.type === 'user'`) — that one is locked in. Background windows and other projects do not steal it.
2. Subagent prompts and automatic continuations (`item.type === 'synthetic'`) never change focus.
3. With no focus yet (fresh start), it falls back to the global priority rule:
   `waiting > error > working > thinking > result > success`.

This exists because, with three sessions busy at once, the global priority rule made the pet switch
sessions every few seconds and restart its animation from frame 0 — it looked like nothing was running.

### Requirements

- macOS (built and verified on Apple Silicon; Intel untested), Electron 43
- OpenCode **2.2.7** (the bridge implements that version's `ctx.event.subscribe()` event shapes)
- Building: Node **>= 22.12**, npm, bun (for the plugin bundle)
- A local unpacked Electron distribution (`npm run ensure:electron` puts it in `~/.opencode-pet/electron`)

### Build

```bash
npm install

(cd plugin && bun run build)      # -> plugin/dist/server.js

npm run build:desktop-core        # -> runtime/electron-helper/shared-core.js (only when src/shared changes)
npm run bundle                    # -> lib/
npm run dist                      # -> dist-app/mac-arm64/OpenCode Pet.app
```

Order matters: `build:desktop-core` → `bundle` → `dist`. A missing `shared-core.js` shows up as a
window with **nothing drawn in it**.

### Install

```bash
cp -R "dist-app/mac-arm64/OpenCode Pet.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/OpenCode Pet.app"
open "/Applications/OpenCode Pet.app"
```

First launch writes `~/Library/LaunchAgents/com.opencode.pet.plist`, hands itself to launchd and exits
the unmanaged instance. After that it starts at login and is restarted within 10s if killed.

### Install the OpenCode plugin

```bash
ln -s "$PWD/plugin" ~/.config/opencode/plugin/opencode-pet
opencode plugin list          # expect: opencode-pet  local
```

The plugin loads at **OpenCode server startup**, so restart OpenCode (the server, not the pet). It retries
silently while the daemon is down and never blocks.

### Usage

- Drag / throw / double-click slingshot / context menu / sleep / todos: same as upstream dsh-pet.
- First context-menu entry opens the local **AI settings** page (tokenized URL: balance, chat, pet config).
  Optional — work-status linkage needs no model.
- Tray: show/hide pet, **launch at login** (install/remove the LaunchAgent), **quit** (clean, launchd will
  not restart it).
- Data and logs in `~/.opencode-pet/`: `runtime.json` (port + token, 0600), `dsh-pet/logs.txt`,
  `dsh-pet/main-config.jsonc` (optional user config), `dsh-pet/standalone-ai.json`.

### Development

```bash
npm test                 # 2510 cases (host/shared/node side)
npm run typecheck
(cd plugin && npm test && npm run typecheck)

npm run start:app        # foreground (OPENCODE_PET_NO_RELAUNCH=1, bypasses launchd)
OPENCODE_PET_BRIDGE_DEBUG=1 npm run start:app   # bridge traffic logs
```

Layout: `src/app` (entry, HTTP, bridge wiring, launchd, tray) · `src/standalone` (fake ctx, standalone HTTP,
settings page) · `src/bridge` (protocol, translate, link, routes, runtime file) · `src/host` (upstream host
half) · `src/shared` + `runtime` (shared state/physics/animation and the desktop helper) · `plugin/`
(OpenCode server plugin) · `assets/` (webm animations, fonts, memes, sounds, built-in config).

### Troubleshooting

| Symptom                      | Fix                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double-click does nothing    | `launchctl print gui/$(id -u)/com.opencode.pet`; check the app path in the plist                                                                            |
| Window exists but is empty   | rerun `npm run build:desktop-core`; confirm `runtime/electron-helper/shared-core.js`                                                                        |
| Pet idle while OpenCode runs | `opencode plugin list` shows `opencode-pet`; `~/.opencode-pet/runtime.json` exists; OpenCode is 2.2.7                                                       |
| Pet follows another session  | send a message in the session you want (focus is set by user messages)                                                                                      |
| Inspect current state        | `curl -H "X-DSH-Pet-Token: $(jq -r .token ~/.opencode-pet/runtime.json)" "http://127.0.0.1:$(jq -r .port ~/.opencode-pet/runtime.json)/dsh-pet-7340/state"` |
| Gatekeeper blocks first open | right-click → Open, or the `xattr` command above                                                                                                            |

### Uninstall

```bash
launchctl bootout "gui/$(id -u)/com.opencode.pet" 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.opencode.pet.plist
rm -rf "/Applications/OpenCode Pet.app"
rm -f ~/.config/opencode/plugin/opencode-pet
rm -rf ~/.opencode-pet        # config + logs, if you want them gone
```

### Known limitations

- Ships only an unpacked macOS directory (`mac:dir`): no dmg/zip, no signing, no notarization.
- Unchecking "launch at login" also stops the running pet (the next launch is what actually skips startup).
- Focus lives in memory only: after a pet restart it waits for your next message to re-focus.
- No per-batch event cap on the bridge (only the 100ms batching window).
- Multi-display and mixed-DPI setups are not covered by automated checks.

### Docs

- [docs/design.md](docs/design.md) — design baseline (why a standalone process, why fork the upstream
  standalone mode) plus an "implementation vs. design" diff at the end
- [docs/bridge-protocol.md](docs/bridge-protocol.md) — the bridge v1 reference (endpoints, auth, event
  table, focus rules)
- [docs/opencode-2.2.7-events.md](docs/opencode-2.2.7-events.md) — probe findings for 2.2.7, including
  which signal can serve as focus
- [docs/implementation-plan.md](docs/implementation-plan.md) — the original execution plan, kept as a
  changelog

### License & credits

- **Code**: MIT (see `LICENSE`); upstream copyright headers kept.
- **Animations, prompts, source videos**: CC BY-NC-SA 4.0, **non-commercial**; public distribution requires
  attribution with a link to the upstream repo, and derivatives must use the same license.
- The character is a community fan creation ("大肥鱼 / 溟月"), not an official one.

See `NOTICE` for the full text.
