# 实施计划（已完成，保留作变更记录）

> **状态**：Task 0–9 已全部执行并验收（2026-11-11 到 2026-11-12）。这是一份历史文档：
> 任务拆解、验收点、以及「为什么先做这一步」仍然有参考价值，但**不要**照它重新执行一遍。
> 后续的真实差异（打包形态、桥路径、焦点策略…）见 [`design.md` 第 16 节](design.md#16-实现与设计的差异)。

**Goal:** 在 macOS 上交付一只常驻桌面的透明宠物；它由独立 Electron 进程承载，OpenCode 2.2.7 通过本地桥推送会话状态，OpenCode 关闭后宠物继续待机。

**Architecture:** fork dsh-pet 的独立应用模式（一个 Electron 进程 = 本机 HTTP + 宿主半侧 + 唯一透明窗 + 托盘），新增 `src/bridge/*` 接收 OpenCode 事件并翻译成 dsh-pet 已有的 DSH 事件形状；另建一个本地 OpenCode server plugin 把 2.2.7 的事件归一化后 POST 过来。自启与崩溃恢复统一由 launchd 托管。

**Tech Stack:** TypeScript、Node ≥ 22.12、Electron 43.3.0、tsdown、node:test（`--experimental-strip-types`）、OpenCode 2.2.7 plugin API、launchd。

**Spec:** [`docs/design.md`](design.md)（本计划的每个「为什么」都以它为准）

---

## Global Constraints

- 目标 OpenCode **2.2.7**；本机 2.1.3 必须先升级。插件 API 以 2.2.7 为准。
- 项目根目录：`<repo>/`。
- 宠物数据目录：`~/.opencode-pet`；可用 `OPENCODE_PET_HOME` 覆盖。
- 桥协议版本 `protocol: 1`；运行时文件 `~/.opencode-pet/runtime.json`，权限 0600，含 `port` / `token` / `pid`。
- HTTP 只绑 `127.0.0.1`；桥接口必须带 `X-DSH-Pet-Token`（v1 沿用该内部头名），拒绝任何带 `Origin` 的请求。
- 单实例、单宠物：`config.pets` 只允许 1 项；多开功能关闭。
- 运行期素材全部走本机 HTTP，不联网。
- 不自动修改用户的 `opencode.json`；插件以本地目录 / 一行配置安装。
- 仅本机自用：ad-hoc 签名，不做公证，不发 npm。
- 保留 dsh-pet 的 MIT 版权头、`NOTICE` 与 CC BY-NC-SA 署名。
- 触摸到的上游测试必须继续通过；新增逻辑一律先写失败测试。

---

## Review Focus

1. **OpenCode 从未启动 / 已退出**：宠物保持空闲，插件不刷日志、不产生重试风暴（Task 6/7）。
2. **宠物守护进程重启**（端口与 token 变化）：插件在 3 次失败后重读 `runtime.json`，状态不卡在“工作”（Task 5/7）。
3. **子代理 / 委派会话**：不弹完成通知，父会话状态仍正常（Task 4）。
4. **事件突发**（多工具、多会话、权限连续弹出）：去重、批量、内存有界（Task 6/7）。
5. **`runtime.json` 缺失、损坏或权限不对**：插件不崩溃、不泄 token，桥返回 403（Task 5/7）。
6. **未知事件 / 字段变化**：忽略并记录 debug，不影响已识别事件（Task 4/7）。

---

## Task 0: M0 探针（spike，不写测试，不保留代码）

**Files:**

- Create (throwaway): `/private/var/folders/nj/s26xn_fx4m36983m4fn8608r0000gp/T/opencode-pet-probe/`
- Create: `docs/superpowers/notes/opencode-2.2.7-events.md`（只保留观测笔记）

**Interfaces:**

- Consumes: 无。
- Produces: 事实清单——2.2.7 的本地插件安装方式、`ctx.event.subscribe()` 的真实事件名与字段、`plugins` 配置写法。Task 7 直接使用。

- [ ] **Step 1: 升级 OpenCode 并确认版本**

Run: `opencode upgrade`（失败则从 GitHub Release 安装 2.2.7）
Expected: `opencode --version` 输出 `2.2.7`；`/Applications/OpenCode.app` 的 `CFBundleShortVersionString` 也是 `2.2.7`。

- [ ] **Step 2: 写最小探针插件**

`index.ts` 只需：

```ts
import { Plugin } from '@opencode/plugin';

export default Plugin.define({
  id: 'opencode-pet-probe',
  async setup(ctx) {
    console.log('[probe] plugin loaded');
    for await (const event of ctx.event.subscribe()) {
      console.log('[probe] event', JSON.stringify(event).slice(0, 500));
    }
  },
});
```

用 `bun build index.ts --outfile dist/server.js --target node --format esm --external @opencode/plugin` 构建。

- [ ] **Step 3: 装进 OpenCode 并确认加载**

按 2.2.7 的实际规则二选一（以探针结果为准，并记录到笔记）：

- 放进 `~/.config/opencode/plugin/` 下的目录；或
- 在 `~/.config/opencode/opencode.json` 的 `plugins` 里写本地包名/路径。

启动 `opencode`，跑一个会调用工具的会话。
Expected: 日志出现 `[probe] plugin loaded`，随后出现 `session.execution.*`、`session.tool.called`、`session.tool.success`、`permission.asked` 等事件。

- [ ] **Step 4: 记录笔记**

`docs/superpowers/notes/opencode-2.2.7-events.md` 写明：安装方式、事件名、每个关键事件的顶层字段（`sessionID`、`id`、`name`、`error`、`reason` 等）、`ctx.session.list()` 是否返回 `title`/`parentID`。
Expected: Task 4/7 不再需要猜字段。

- [ ] **Step 5: 清理探针**

删除临时目录与 OpenCode 里的探针插件；只保留笔记。
Expected: `opencode` 启动不再打印 `[probe]`。

> 如果探针在 2.2.7 上跑不通，**停止**，先解决版本/加载方式，不要开始 Task 1。

---

## Task 1: Fork dsh-pet 并跑通独立 app（macOS）

**Files:**

- Create: `opencode-pet/`（从 `pet/dsh-pet/dsh-pet/` 复制，排除 `assets/preview`、`.git`、`node_modules`、`lib`）
- Modify: `opencode-pet/package.json`（只改 `name`/`description`，其余 Task 2）
- Create: `opencode-pet/NOTICE`
- Test: 手工验收（构建 + 启动）

**Interfaces:**

- Consumes: Task 0 的版本结论。
- Produces: 可运行的 `lib/app.js`、`node_modules`、本机 Electron；后续任务都在这个仓库里改。

- [ ] **Step 1: 在 upstream clone 里补齐素材**

Run:

```bash
cd ../dsh-pet
git sparse-checkout add dsh-pet/assets/webm dsh-pet/assets/memes dsh-pet/assets/fonts dsh-pet/assets/pic dsh-pet/assets/sound
```

Expected: `dsh-pet/assets/webm` 有 114 个 `.webm`，总计约 58MB。

- [ ] **Step 2: 复制成新项目**

Run:

```bash
cd ..
rsync -a --exclude .git --exclude node_modules --exclude lib --exclude assets/preview \
  dsh-pet/dsh-pet/ opencode-pet/
cd opencode-pet && git init && git add -A
git commit -m "chore: fork dsh-pet at <upstream-commit>"
```

Expected: 首次提交完成；`assets/webm` 已入库；`assets/preview` 不存在。

- [ ] **Step 3: 安装依赖并构建**

Run: `npm install && npm run bundle`
Expected: `lib/app.js`、`lib/standalone.js`、`lib/chat-panel.js` 生成。

- [ ] **Step 4: 准备 Electron 并启动**

Run: `npm run ensure:electron && npm run start:app`
Expected: 屏幕上出现一只透明、置顶的宠物；终端出现 `[dsh-pet-app] 本机服务 http://127.0.0.1:<port>`。

- [ ] **Step 5: 验证健康接口**

Run: `curl -s http://127.0.0.1:<port>/health`
Expected: JSON 含 `"name":"dsh-pet-app"`、`"pets"` 数组且只有 1 项。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "chore: scaffold opencode-pet from dsh-pet"
```

---

## Task 2: 数据目录与应用身份改名

**Files:**

- Modify: `src/host/helper/electron.ts:109-112`（`dshHomeDir` 的实现，保留函数名以减少 34 处调用点改动）
- Modify: `runtime/electron-helper/main/user-data.js`（独立 helper 的 home 解析）
- Modify: `runtime/electron-helper/main.js:60-70`（`app.setName`、`APP_MODE` 的 userData 路径）
- Modify: `src/host/storage-paths.ts`（`DESKTOP_APP_NAME`）
- Modify: `package.json`（`name`、`description`、`bin`）
- Modify: `electron-builder.yml`（`appId`、`productName`、`copyright`）
- Test: `src/host/helper/electron.test.ts`、`src/host/storage-paths.test.ts`

**Interfaces:**

- Consumes: Task 1 的可运行 app。
- Produces: `dshHomeDir()` 返回 `~/.opencode-pet`（或 `OPENCODE_PET_HOME`）；`DESKTOP_APP_NAME = "opencode-pet-electron-helper"`；后续任务直接用这个 home 写 runtime 文件。

- [ ] **Step 1: 写失败测试**

在 `src/host/helper/electron.test.ts` 增加：

```ts
test('home defaults to ~/.opencode-pet', () => {
  assert.equal(dshHomeDir({ HOME: '/Users/me', OPENCODE_PET_HOME: undefined }), '/Users/me/.opencode-pet');
});
test('OPENCODE_PET_HOME wins', () => {
  assert.equal(dshHomeDir({ HOME: '/Users/me', OPENCODE_PET_HOME: '/tmp/pet' } as never), '/tmp/pet');
});
```

把 `dshHomeDir` 的签名改为可注入 `env: NodeJS.ProcessEnv = process.env`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/host/helper/electron.test.ts`
Expected: FAIL（仍返回 `.dsh`）。

- [ ] **Step 3: 改实现**

`src/host/helper/electron.ts`：

```ts
export function dshHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const userProfile = env.USERPROFILE || env.HOME || '';
  return env.OPENCODE_PET_HOME || join(userProfile, '.opencode-pet');
}
```

同步修改 `runtime/electron-helper/main/user-data.js` 的默认 home 为 `~/.opencode-pet`，`app.setName("opencode-pet-electron-helper")`，`APP_MODE` 的 `app.setPath("userData", join(appData, "opencode-pet"))`。

- [ ] **Step 4: 更新一致性测试**

`src/host/storage-paths.test.ts` 中读取 `runtime/electron-helper/main.js` 的断言改为 `opencode-pet-electron-helper`；`DESKTOP_APP_NAME` 同步。
Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/host/helper/electron.test.ts src/host/storage-paths.test.ts`
Expected: PASS。

- [ ] **Step 5: 真机验证目录**

Run: `npm run bundle && npm run start:app`
Expected: `~/.opencode-pet/` 出现 `logs.txt`、配置；`~/.dsh/dsh-pet` 不再新增文件。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: use ~/.opencode-pet and opencode-pet app identity"
```

> v1 保留内部名：`DSH_PET_*` 环境变量、`/dsh-pet-7340` 路由段、`X-DSH-Pet-Token` 头。它们只是内部协议，改名留给后续版本。

---

## Task 3: 独立模式的事件 hub

**Files:**

- Modify: `src/standalone/context.ts:151`（把 `on()` 的空实现换成 hub）
- Test: `src/standalone/context.test.ts`

**Interfaces:**

- Consumes: 无。
- Produces:

```ts
export interface StandaloneContext {
  ctx: Record<string, unknown>;
  routes: RegisteredRoute[];
  failures: string[];
  emit(name: string, ...args: unknown[]): void;
  dispose(): Promise<void>;
}
export function createStandaloneContext(options: StandaloneContextOptions): StandaloneContext;
```

`ctx.on(name, handler)` 返回取消订阅函数；`emit` 按注册顺序调用，单个 handler 抛错只记日志。

- [ ] **Step 1: 写失败测试**

在 `src/standalone/context.test.ts` 增加：

```ts
test('on/emit dispatches to every handler', () => {
  const { ctx, emit } = createStandaloneContext(baseOptions());
  const seen: string[] = [];
  ctx.on('session/event', () => seen.push('a'));
  ctx.on('session/event', () => seen.push('b'));
  emit('session/event', {}, { type: 'turn/start' });
  assert.deepEqual(seen, ['a', 'b']);
});
test('unsubscribe stops delivery', () => {
  /* on 返回的函数调用后不再收到 */
});
test('a throwing handler does not stop the next', () => {
  /* 第一个抛错，第二个仍收到 */
});
test('unknown event name is a no-op', () => {
  /* emit 不抛 */
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/standalone/context.test.ts`
Expected: FAIL（`emit` 不存在 / handler 不触发）。

- [ ] **Step 3: 实现 hub**

在 `context.ts` 内加 `createEventHub(logger)`，返回 `{ on, emit }`；`context.on = hub.on`；`StandaloneContext.emit = hub.emit`。
`emit` 用 `try/catch` 包每个 handler，`logger.warn` 记录。

- [ ] **Step 4: 运行测试**

Expected: PASS；上游 `context.test.ts` 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/standalone/context.ts src/standalone/context.test.ts
git commit -m "feat: event hub in standalone context"
```

---

## Task 4: 桥协议与事件翻译

**Files:**

- Create: `src/bridge/protocol.ts`
- Create: `src/bridge/translate.ts`
- Test: `src/bridge/translate.test.ts`
- Create: `docs/superpowers/notes/` 里的字段笔记作为参考（Task 0）

**Interfaces:**

- Consumes: Task 0 的真实字段；dsh-pet 的 DSH 事件名。
- Produces:

```ts
export const BRIDGE_PROTOCOL = 1;
export type BridgeEventType =
  | 'session.execution.started'
  | 'session.execution.succeeded'
  | 'session.execution.failed'
  | 'session.execution.interrupted'
  | 'session.tool.input.started'
  | 'session.tool.called'
  | 'session.tool.success'
  | 'session.tool.failed'
  | 'permission.asked'
  | 'permission.replied'
  | 'session.text.ended'
  | 'session.idle'
  | 'session.meta';
export interface BridgeEvent {
  id: string;
  type: BridgeEventType | string;
  sessionID: string;
  sessionTitle?: string;
  parentID?: string | null;
  at: number;
  data?: Record<string, unknown>;
}
export interface BridgeSession {
  id: string;
  title?: string;
  parentID?: string | null;
  delegationDepth?: number;
}
export interface DshSessionEvent {
  type: string;
  data?: Record<string, unknown>;
}
export function translate(
  event: BridgeEvent,
  depthOf: (sessionID: string) => number,
): { session: BridgeSession; event: DshSessionEvent } | null;
```

映射：

| Bridge type                                          | DSH type            | data                                      |
| ---------------------------------------------------- | ------------------- | ----------------------------------------- |
| `session.execution.started`                          | `turn/start`        | `{}`                                      |
| `session.tool.input.started` / `session.tool.called` | `tool/call`         | `{ name, callId }`                        |
| `session.tool.success` / `session.tool.failed`       | `tool/result`       | `{ callId, isError }`                     |
| `permission.asked`                                   | `approval/asked`    | `{ action, message }`                     |
| `permission.replied`                                 | `approval/replied`  | `{}`（新增内部事件，host 侧忽略也不报错） |
| `session.execution.succeeded`                        | `turn/end`          | `{ reason: "completed" }`                 |
| `session.execution.failed`                           | `turn/end`          | `{ reason: "error", error }`              |
| `session.execution.interrupted`                      | `turn/end`          | `{ reason: "aborted" }`                   |
| `session.idle`                                       | `turn/end`          | `{ reason: "idle" }`                      |
| `session.text.ended`                                 | `assistant/message` | `{ text }`                                |
| `session.meta`                                       | 不发射              | 只更新标题                                |

- 子代理：`parentID != null` → `session.delegationDepth = depthOf(id)`（父为 0）；`header.origin = "subagent"`。
- 未知 type → 返回 `null`。

- [ ] **Step 1: 写失败测试**

`src/bridge/translate.test.ts`：

```ts
test('execution.started -> turn/start', () => {
  assert.deepEqual(translate(ev('session.execution.started'), () => 0)?.event, { type: 'turn/start', data: {} });
});
test('tool.called keeps name and call id', () => {
  const t = translate({ ...ev('session.tool.called'), data: { name: 'bash', id: 'call_1' } }, () => 0);
  assert.deepEqual(t?.event, { type: 'tool/call', data: { name: 'bash', callId: 'call_1' } });
});
test('failed -> turn/end error', () => {
  /* reason === "error" */
});
test('subagent session carries delegation depth', () => {
  /* delegationDepth === 1 */
});
test('unknown type returns null', () => {
  /* null */
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/bridge/translate.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 protocol 与 translate**

只做纯函数；不读时间、不读环境。`ev()` 测试辅助自己构造。

- [ ] **Step 4: 运行测试**

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/bridge/protocol.ts src/bridge/translate.ts src/bridge/translate.test.ts
git commit -m "feat: bridge protocol and event translation"
```

---

## Task 5: 运行时文件 + 桥路由 + 鉴权

**Files:**

- Create: `src/bridge/runtime.ts`
- Create: `src/bridge/routes.ts`
- Modify: `src/app/main.ts:100-140`
- Test: `src/bridge/runtime.test.ts`、`src/bridge/routes.test.ts`

**Interfaces:**

- Consumes: Task 3 的 `emit`、Task 4 的 `BridgeEvent`、`createRequestSecurity()`、`writePrivateJson`。
- Produces:

```ts
export interface RuntimeInfo {
  name: 'opencode-pet';
  version: string;
  pid: number;
  port: number;
  token: string;
  protocol: 1;
  startedAt: string;
}
export function runtimeFile(home: string): string;
export function writeRuntime(home: string, info: RuntimeInfo): () => void;
export function readRuntime(home: string): RuntimeInfo | undefined;
export function createBridgeRoutes(deps: { link: BridgeLink; log: (message: string) => void }): RegisteredRoute[];
```

路由（`kind: "exact"`）：

- `POST /dsh-pet-7340/opencode-pet/bridge/v1/hello`
- `POST /dsh-pet-7340/opencode-pet/bridge/v1/events`
- `POST /dsh-pet-7340/opencode-pet/bridge/v1/bye`

每个 handler：拒绝 `req.headers.origin`（403）；body 上限 256KB；JSON 解析失败 400；调用 `link` 对应方法；返回 `{ ok: true }`。

- [ ] **Step 1: 写失败测试（runtime）**

```ts
test('writes 0600 JSON and cleans up its own file', () => {
  const dir = tempHome();
  const release = writeRuntime(dir, info({ pid: 1, token: 't' }));
  assert.equal(statSync(runtimeFile(dir)).mode & 0o777, 0o600);
  release();
  assert.equal(existsSync(runtimeFile(dir)), false);
});
test("does not delete another instance's file", () => {
  /* pid/token 不匹配时保留 */
});
test('readRuntime returns undefined for corrupt JSON', () => {
  /* 写坏内容 -> undefined, 不抛 */
});
```

- [ ] **Step 2: 写失败测试（routes）**

用一个 `http.createServer` 挂 handler，`fetch` 调用：

```ts
test('rejects requests with an Origin header', async () => {
  const res = await post(eventsUrl, body, { origin: 'http://evil.test' });
  assert.equal(res.status, 403);
});
test('accepts a valid bridge batch', async () => {
  /* 200, link.events called once */
});
test('rejects bodies over 256KB', async () => {
  /* 413 */
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/bridge/runtime.test.ts src/bridge/routes.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现并接线**

`writeRuntime` 用 `writePrivateJson`，返回幂等 release（只删 pid+token 匹配的文件）。
`src/app/main.ts` 顺序：

```ts
const link = createBridgeLink({ emit: context.emit })
routes.push(...createBridgeRoutes({ link, log }))
const server = await startRouter(routes, { ... })
port = server.port
const releaseRuntime = writeRuntime(dshHomeDir(), {
  name: "opencode-pet", version: packageVersion(packageRoot), pid: process.pid,
  port, token: security.token, protocol: 1, startedAt: new Date().toISOString(),
})
```

在 `app.on("will-quit")` 里调用 `releaseRuntime()`（放在 `server.close()` 之前）。

- [ ] **Step 5: 运行测试与手工验证**

Run: 上述两个测试；然后 `npm run bundle && npm run start:app`。
Expected: `~/.opencode-pet/runtime.json` 存在、0600；`curl` 带 token POST `/hello` 返回 `{ok:true}`；不带 token 返回 403。

- [ ] **Step 6: 提交**

```bash
git add src/bridge/runtime.ts src/bridge/routes.ts src/app/main.ts src/bridge/*.test.ts
git commit -m "feat: bridge routes and runtime discovery file"
```

---

## Task 6: 桥接状态机（心跳、超时、去重）

**Files:**

- Create: `src/bridge/link.ts`
- Test: `src/bridge/link.test.ts`
- Modify: `src/app/main.ts`（创建 link 并定时 `tick`）

**Interfaces:**

- Consumes: Task 3 `emit`、Task 4 `translate`、Task 5 的路由。
- Produces:

```ts
export interface HelloBody {
  protocol: number;
  pluginVersion: string;
  server?: { version?: string; url?: string };
  sessions?: Array<{ id: string; title?: string; parentID?: string | null }>;
}
export interface BridgeLink {
  hello(body: HelloBody): { ok: true };
  events(body: { events: BridgeEvent[] }): { ok: true };
  bye(): { ok: true };
  tick(now: number): void;
  snapshot(): { connected: boolean; lastSeenAt: number | null; active: string[] };
}
export function createBridgeLink(deps: {
  emit: (name: string, ...args: unknown[]) => void;
  now?: () => number;
  timeoutMs?: number;
}): BridgeLink;
```

行为：

- `hello`：`connected=true`，`lastSeen=now`，记录标题与父会话。
- `events`：按 `id` 去重（保留最近 1000 个），逐个 `translate` 后 `emit("session/event", session, event)`；`turn/start` 加入 active，`turn/end` 移出；未知事件忽略。
- `bye`：对所有 active 发 `turn/end {reason:"aborted"}`，`connected=false`，清空 active。
- `tick(now)`：`connected && now-lastSeen > timeoutMs`（默认 15000）→ 同 `bye` 的清理，但保留 `lastSeenAt` 用于展示。
- 去重 Map 超过 1000 时按插入顺序删最旧。

- [ ] **Step 1: 写失败测试**

用可注入 `now`：

```ts
test('events emit translated session events and dedupe ids', () => {
  /* 同一 id 只 emit 一次 */
});
test('heartbeat keeps the link alive', () => {
  /* tick(1000) + tick(20000) 仍 connected */
});
test('timeout emits idle for every active session exactly once', () => {
  link.hello(hello());
  link.events({ events: [execStarted('s1')] });
  link.tick(16000);
  link.tick(17000);
  assert.equal(idleEmits('s1'), 1);
});
test('bye clears active sessions', () => {
  /* bye 后 snapshot().active 为空 */
});
test('dedupe memory stays bounded', () => {
  /* 1100 个 id 后 map 大小 <= 1000 */
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/bridge/link.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 link**

在 `main.ts` 里：

```ts
const link = createBridgeLink({ emit: context.emit });
const timer = setInterval(() => link.tick(Date.now()), 5000);
```

`will-quit` 清 timer。

- [ ] **Step 4: 运行测试**

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/bridge/link.ts src/bridge/link.test.ts src/app/main.ts
git commit -m "feat: bridge link heartbeat, timeout and dedupe"
```

---

## Task 7: OpenCode 插件（本地目录）

**Files:**

- Create: `plugin/package.json`
- Create: `plugin/tsconfig.json`
- Create: `plugin/types/opencode-plugin.d.ts`（最小类型声明，避免依赖未发布的包）
- Create: `plugin/src/normalize.ts`
- Create: `plugin/src/client.ts`
- Create: `plugin/src/index.ts`
- Test: `plugin/src/normalize.test.ts`、`plugin/src/client.test.ts`
- Create: `plugin/README.md`

**Interfaces:**

- Consumes: Task 5 的 runtime 文件与路由；Task 4 的 `BridgeEvent` 形状。
- Produces:

```ts
// normalize.ts
export interface PluginEvent {
  type: string;
  [key: string]: unknown;
}
export function normalize(event: PluginEvent, titles: Map<string, string>): BridgeEvent | null;

// client.ts
export interface BridgeClient {
  send(events: PluginEvent[]): Promise<void>; // 内部批量 + 归一化
  bye(): Promise<void>;
  dispose(): void;
}
export function createBridgeClient(options: {
  home: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  batchMs?: number;
  heartbeatMs?: number;
  log?: (message: string) => void;
}): BridgeClient;
```

`index.ts`：

```ts
import { Plugin } from '@opencode/plugin';
import { createBridgeClient } from './client.js';

export default Plugin.define({
  id: 'opencode-pet',
  async setup(ctx) {
    const client = createBridgeClient({ home: process.env.OPENCODE_PET_HOME ?? join(homedir(), '.opencode-pet') });
    const titles = new Map<string, string>();
    // 先 seed 现有会话标题（字段以 Task 0 笔记为准）
    const heartbeat = setInterval(() => void client.send([]), 5000);
    for await (const event of ctx.event.subscribe()) {
      if (event.type === 'session.created' || event.type === 'session.renamed') {
        const title = (event as { title?: string }).title;
        if (title) titles.set(String((event as { sessionID: string }).sessionID), title);
      }
      void client.send([event as never]);
    }
    return () => {
      clearInterval(heartbeat);
      void client.bye();
      client.dispose();
    };
  },
});
```

实现要求：

- 读不到 runtime 文件：静默重试（5s），每分钟最多记一条日志。
- 连续 3 次请求失败：清空缓存的 runtime，下次重读。
- 批量：100ms 或 50 条先到者；发送失败丢弃本批（volatile），不阻塞事件循环。
- 不发送 `session.text.delta` 等高频流式事件；只发 `session.text.ended`。

- [ ] **Step 1: 写失败测试（normalize）**

```ts
test('maps tool.called to bridge event', () => {
  /* type/name/id/sessionID */
});
test('drops streaming deltas', () => {
  /* session.text.delta -> null */
});
test('keeps unknown events? no: returns null', () => {
  /* 未知 -> null */
});
```

- [ ] **Step 2: 写失败测试（client）**

注入 fake fetch 与临时 home：

```ts
test('batches events into one request', async () => {
  /* 2 个事件 -> 1 次 fetch */
});
test('re-reads runtime after three failures', async () => {
  /* fetch 失败 3 次后重新 readFile */
});
test('does nothing when runtime is missing', async () => {
  /* 0 次 fetch, 不抛 */
});
test('bye posts and stops heartbeats', async () => {
  /* dispose 后无定时器 */
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --experimental-strip-types --test "plugin/src/**/*.test.ts"`
Expected: FAIL。

- [ ] **Step 4: 实现并构建**

`plugin/package.json`：

```json
{
  "name": "opencode-pet",
  "version": "0.1.0",
  "type": "module",
  "exports": { "./server": "./dist/server.js" },
  "scripts": {
    "build": "bun build src/index.ts --outfile dist/server.js --target node --format esm --external @opencode/plugin",
    "typecheck": "tsc --noEmit",
    "test": "node --experimental-strip-types --test \"src/**/*.test.ts\""
  }
}
```

Run: `cd plugin && npm run build && npm run typecheck && npm test`
Expected: PASS，`dist/server.js` 生成，且不含 `@opencode/plugin` 的打包副本。

- [ ] **Step 5: 安装到 OpenCode 并做端到端验证**

按 Task 0 笔记的方式安装 `plugin/`（本地目录或 `plugins` 配置）。
启动宠物 + OpenCode，跑一个工具会话。
Expected: 宠物从 idle → thinking → working → result → success；关掉 OpenCode，15 秒内回 idle。

- [ ] **Step 6: 提交**

```bash
git add plugin
git commit -m "feat: opencode-pet server plugin"
```

---

## Task 8: launchd 自启与崩溃恢复

**Files:**

- Create: `src/app/launchd.ts`
- Test: `src/app/launchd.test.ts`
- Modify: `src/app/main.ts`（启动委托、tick 之外新增 `--launchd` 分支）
- Modify: `src/host/routes/index.ts` 或 `src/app/router.ts`（新增 `GET/POST /dsh-pet-7340/launchd`）
- Modify: `runtime/electron-helper/main/tray.js`（“开机启动”勾选项）
- Modify: `runtime/electron-helper/main.js`（把 launchd 状态传给 tray）

**Interfaces:**

- Consumes: Task 5 的鉴权与主进程启动流程。
- Produces:

```ts
export const LAUNCHD_LABEL = 'com.opencode.pet';
export function launchAgentPath(home: string): string;
export function plistFor(execPath: string): string;
export function isLaunchedByLaunchd(argv: string[], env: NodeJS.ProcessEnv): boolean;
export function launchAgentInstalled(home: string): boolean;
export function installLaunchAgent(home: string): Promise<void>;
export function removeLaunchAgent(home: string): Promise<void>;
```

`plistFor` 必须包含：`RunAtLoad=true`、`KeepAlive={SuccessfulExit:false}`、`ThrottleInterval=10`、`ProgramArguments` 第一项是 `.app` 的 `Contents/MacOS/OpenCode Pet`、第二项 `--launchd`。

- [ ] **Step 1: 写失败测试**

```ts
test('plist has label, RunAtLoad and crash-only KeepAlive', () => {
  /* 字符串断言 */
});
test('detects --launchd', () => {
  /* true/false */
});
test('install writes a plist into LaunchAgents', async () => {
  /* 临时 home，不调用 launchctl */
});
test('remove deletes only our plist', async () => {
  /* 其它文件保留 */
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/app/launchd.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现与启动委托**

`main.ts` 在 `app.requestSingleInstanceLock()` 之后、`boot()` 之前：

```ts
if (
  process.platform === 'darwin' &&
  !isLaunchedByLaunchd(process.argv, process.env) &&
  !process.env.OPENCODE_PET_NO_RELAUNCH
) {
  await installLaunchAgent(dshHomeDir());
  // launchctl bootstrap gui/$UID <plist>; launchctl kickstart -k gui/$UID/com.opencode.pet
  app.exit(0);
}
```

注意：`installLaunchAgent` 只在首次或 plist 内容变化时写；`launchctl` 失败时记录日志并**继续当前进程**（不要让宠物起不来）。

- [ ] **Step 4: 加设置与托盘开关**

新增路由 `GET /dsh-pet-7340/launchd` → `{ installed: boolean }`；`POST` → `{ enabled: boolean }` 调 install/remove。
设置页（`standalone/settings-page`）加一个复选框；托盘菜单加 `{ type: "checkbox", label: "开机启动", checked, click }`，`click` 调 `hostRequest` 后重建菜单。
Run: `node --experimental-strip-types --import ./scripts/test-register.mjs --test src/app/launchd.test.ts`
Expected: PASS。

- [ ] **Step 5: 真机验证**

1. 首次 `start:app` → 进程委托给 launchd 后退出，宠物由 launchd 拉起。
2. `kill <pid>` → 10 秒内新进程出现。
3. 托盘取消“开机启动” → plist 删除；再勾选 → 恢复。
4. 托盘“退出” → 进程退出且不复活。

- [ ] **Step 6: 提交**

```bash
git add src/app/launchd.ts src/app/launchd.test.ts src/app/main.ts runtime/electron-helper/main/tray.js runtime/electron-helper/main.js
git commit -m "feat: launchd autostart and crash recovery"
```

---

## Task 9: 打包、NOTICE、安装文档与验收

**Files:**

- Modify: `electron-builder.yml`（mac 目标）
- Create: `scripts/dist-mac.mjs`（或扩展现有 `scripts/dist.mjs` 支持 mac）
- Create: `NOTICE`
- Create: `README.md`（安装、自启、授权、故障排查）
- Modify: `package.json`（`dist:mac` 脚本）

**Interfaces:**

- Consumes: Task 1-8 的全部行为。
- Produces: `dist-app/OpenCode Pet.app`（或 `mac-arm64/` 下的产物），可复制到 `/Applications` 并双击运行。

- [ ] **Step 1: 配 electron-builder**

```yaml
appId: com.opencode.pet
productName: OpenCode Pet
mac:
  category: public.app-category.utilities
  target: [dmg, zip]
  identity: null
  extendInfo:
    LSUIElement: true
```

保留现有 `files` 白名单与 `asar: true`；`assets/preview` 继续排除。

- [ ] **Step 2: 构建**

Run: `npm run bundle && node scripts/dist-mac.mjs`
Expected: `dist-app/` 下出现 `.app`；`du -sh` 约 120–180MB（含 58MB webm）。

- [ ] **Step 3: 安装并首次运行**

```bash
cp -R "dist-app/mac-arm64/OpenCode Pet.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/OpenCode Pet.app"
open "/Applications/OpenCode Pet.app"
```

Expected: 一只宠物出现；无 Dock 图标；托盘可见。

- [ ] **Step 4: 跑完整验收清单**

按 spec §10 的“必须通过”8 条逐项打勾：

- [ ] 只有一只，透明/置顶/穿透
- [ ] 拖拽、甩抛、双击弹弓、右键、睡眠、待办
- [ ] OpenCode 工具会话 → 六档状态
- [ ] 关 OpenCode → 15s 回 idle
- [ ] 重开 OpenCode → 自动重连
- [ ] 托盘退出无残留；kill 后 10s 恢复；重启系统自动出现
- [ ] 多屏/缩放位置正确

- [ ] **Step 5: 写 NOTICE 与 README**

`NOTICE` 必须含：dsh-pet 仓库链接、fork 的上游 commit、素材 CC BY-NC-SA 4.0、角色原型出处、非商业声明。
`README` 必须含：安装、把插件装进 OpenCode 的一行配置、开机启动开关、如何退出、日志位置、常见故障（Gatekeeper、端口、素材缺失）。

- [ ] **Step 6: 提交**

```bash
git add electron-builder.yml scripts/dist-mac.mjs NOTICE README.md package.json
git commit -m "chore: package macOS app and document install"
```

---

## 自检记录（写完计划后核对）

- **Spec 覆盖**：意图/目标 → Task 1；单实例单宠物 → Task 1/8；桥与事件 → Task 4/5/6/7；launchd → Task 8；素材本地服务 → Task 1（复用现有路由）；安全 → Task 5；打包/署名 → Task 9；非目标（不改内核、不做 GUI/TUI 渲染）→ 无任务，符合预期。
- **类型一致性**：`BridgeEvent`（Task 4）→ `BridgeLink.events`（Task 6）→ `normalize`（Task 7）字段一致；`emit`（Task 3）→ link（Task 6）→ main（Task 5/6）一致。
- **Review Focus 对应测试**：每条都在 Task 4/5/6/7 的测试步骤里出现。
- **比例**：计划只写签名、映射表与断言，不写完整实现。
