# OpenCode Pet

一只常驻 macOS 桌面的透明宠物。它跟 OpenCode 的会话状态联动（思考 / 工作 / 整理 / 等待 / 成功 / 出错），
OpenCode 关掉后继续待机；不依赖 OpenCode 的窗口，也不改 OpenCode 内核。

> 本仓库是 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的衍生移植。代码 MIT；动画素材
> CC BY-NC-SA 4.0（非商业）。详见 `NOTICE`。

## 组成

| 目录 | 作用 |
| --- | --- |
| `src/app` | 常驻 Electron 应用：本机 HTTP、透明窗、托盘、OpenCode 桥、launchd 自启 |
| `src/host` / `src/shared` / `runtime` | 沿用 dsh-pet 的宿主逻辑、物理/动画与桌面 Helper |
| `plugin/` | OpenCode 2.2.7 server plugin：把会话事件推给本机守护进程 |
| `assets/` | webm 动画、字体、表情、点击音效 |

## 构建

```bash
npm run bundle              # lib/app.js 等
npm run build:desktop-core  # runtime/electron-helper/shared-core.js（首次必须）
npm run ensure:electron     # 下载 Electron 到 ~/.opencode-pet/electron（首次）
node scripts/dist.mjs       # 打包到 dist-app/mac-arm64/OpenCode Pet.app
```

## 安装

```bash
cp -R "dist-app/mac-arm64/OpenCode Pet.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/OpenCode Pet.app"
open "/Applications/OpenCode Pet.app"
```

首次启动会：

1. 写 `~/Library/LaunchAgents/com.opencode.pet.plist`；
2. 通过 launchd 启动受监管的实例并退出当前进程；
3. 在桌面右上角出现一只宠物，托盘出现图标。

之后开机会自动启动；进程被杀掉时 launchd 会在 10 秒内拉起。

## 安装 OpenCode 插件

```bash
ln -s "$PWD/plugin" ~/.config/opencode/plugin/opencode-pet
opencode plugin list        # 出现 opencode-pet local
```

插件读取 `~/.opencode-pet/runtime.json` 找端口与令牌；宠物没启动时它会静默重试，不阻塞 OpenCode。

## 使用

- 拖拽 / 甩抛 / 双击弹弓 / 右键菜单 / 睡觉 / 待办：与 dsh-pet 一致。
- 托盘：
  - 勾选宠物 = 显示/隐藏桌面窗；
  - **开机启动**：安装/移除 LaunchAgent；
  - **退出**：干净退出，launchd 不会重新拉起。
- 数据与日志：`~/.opencode-pet/`（`logs.txt`、`config`、`runtime.json`）。
- OpenCode 联动：宠物跟随**你正在用的那个会话**（最近由你亲自发出消息的会话）——后台窗口/其它
  项目里同时跑着的会话不会抢走展示；还没收到过用户消息时退回「按优先级取最忙的一个」。
  15 秒没有心跳回到空闲。

## 关闭 / 卸载

- 临时关闭：托盘 → 退出。
- 彻底移除：

```bash
launchctl bootout "gui/$(id -u)/com.opencode.pet" 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.opencode.pet.plist
rm -rf "/Applications/OpenCode Pet.app"
rm -f ~/.config/opencode/plugin/opencode-pet
```

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 双击无反应 | 看 `~/Library/LaunchAgents/com.opencode.pet.plist` 是否指向正确的 app 路径；`launchctl print gui/$(id -u)/com.opencode.pet` |
| 只有透明窗、没画面 | 确认 `runtime/electron-helper/shared-core.js` 已构建（`npm run build:desktop-core`） |
| 宠物不跟 OpenCode | 确认 `opencode plugin list` 里有 `opencode-pet`；`~/.opencode-pet/runtime.json` 存在；OpenCode 2.2.7 |
| 首次打开被 Gatekeeper 拦 | 右键 → 打开，或执行上面的 `xattr` |
| 想临时前台调试 | `OPENCODE_PET_NO_RELAUNCH=1 npm run start:app` |

## 授权

- 代码：MIT（见 `LICENSE`）。
- 动画/提示词/源视频：CC BY-NC-SA 4.0，非商业；公开使用需署名并链接原仓库。
- 角色形象为社区二创，非官方形象。
