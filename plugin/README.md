# opencode-pet 桥接插件

把 OpenCode 2.2.7 的会话事件推给本机 `opencode-pet` 守护进程。

## 构建

```bash
cd plugin
npm run build        # 生成 dist/server.js
node --experimental-strip-types --test "src/**/*.test.ts"
npx tsc --noEmit
```

## 安装（本机自用，不发 npm）

把整个 `plugin/` 目录放进 OpenCode 的插件目录：

```bash
ln -s "$PWD/plugin" ~/.config/opencode/plugin/opencode-pet
opencode plugin list      # 应出现 opencode-pet local
```

或者把 `plugin/` 复制到 `~/.config/opencode/plugin/opencode-pet/`。

OpenCode 会读该目录的 `package.json`，通过 `exports["./server"]` 加载 `dist/server.js`。

## 运行前提

- 宠物守护进程已启动，`~/.opencode-pet/runtime.json` 存在。
- 插件只读该文件，不扫描端口；守护进程重启后会在 3 次失败内重读。

## 关闭

从 `~/.config/opencode/plugin/` 移除链接/目录，重启 OpenCode。
