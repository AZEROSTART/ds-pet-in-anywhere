/**
 * macOS 开机自启与崩溃恢复：LaunchAgent plist 的生成、安装、移除。
 *
 * 设计：所有实例都由 launchd 托管（`--launchd`），双击启动只负责 bootstrap 后退出。
 * `KeepAlive` 为 true：崩溃、SIGTERM、kill 都会被拉起；托盘「退出」先在 will-quit 里
 * bootout 再退，bootout 失败则取消退出（宁可留着，也不要复活成“关不掉”）。
 *
 * @module opencode-pet/src/app/launchd
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** LaunchAgent 的 label 与 plist 文件名。 */
export const LAUNCHD_LABEL = 'com.opencode.pet';

/** 可注入的 exec（测试用）。 */
export type Exec = (file: string, args: readonly string[]) => Promise<void>;

/** 默认 exec：launchctl。 */
const defaultExec: Exec = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], (error) => (error ? reject(error) : resolve()));
  });

/** plist 路径。 */
export function launchAgentPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

/** 当前进程是否由 launchd 以 `--launchd` 拉起。 */
export function isLaunchedByLaunchd(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes('--launchd') || env.XPC_SERVICE_NAME === LAUNCHD_LABEL;
}

/** plist 是否已存在。 */
export function launchAgentInstalled(home: string = homedir()): boolean {
  return existsSync(launchAgentPath(home));
}

/** XML 文本转义。 */
function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成 plist。
 *
 * @param args - 可执行文件与参数；最后一项应为 `--launchd`。
 */
export function plistFor(args: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`;
}

/** 当前用户的 launchd domain。 */
function domain(): string {
  return `gui/${process.getuid?.() ?? 0}`;
}

/**
 * 安装并启动 LaunchAgent。
 *
 * @param home - 用户主目录。
 * @param args - 可执行文件与参数。
 * @param exec - 注入的 exec。
 */
export async function installLaunchAgent(
  home: string = homedir(),
  args: readonly string[] = [],
  exec: Exec = defaultExec,
): Promise<void> {
  const file = launchAgentPath(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, plistFor(args), 'utf8');
  try {
    await exec('launchctl', ['bootstrap', domain(), file]);
  } catch {
    // 已 bootstrap 或服务已加载：继续 kickstart。
  }
  try {
    await exec('launchctl', ['kickstart', '-k', `${domain()}/${LAUNCHD_LABEL}`]);
  } catch {
    // kickstart 失败时 plist 仍在，下次登录会自启。
  }
}

/**
 * 只停服务、保留 plist：用于托盘「退出」——立即退出且不被 KeepAlive 拉起，
 * 下次登录仍会自启。
 */
export async function stopLaunchAgent(exec: Exec = defaultExec): Promise<boolean> {
  try {
    await exec('launchctl', ['bootout', `${domain()}/${LAUNCHD_LABEL}`]);
    return true;
  } catch {
    // 没在跑也算已停；真正的失败由调用方决定是否放弃退出。
    return false;
  }
}

/**
 * 移除 LaunchAgent；只删自己的 plist。
 *
 * @param home - 用户主目录。
 * @param exec - 注入的 exec。
 */
export async function removeLaunchAgent(home: string = homedir(), exec: Exec = defaultExec): Promise<void> {
  try {
    await exec('launchctl', ['bootout', `${domain()}/${LAUNCHD_LABEL}`]);
  } catch {
    // 没在跑或已经 bootout：继续删文件。
  }
  try {
    unlinkSync(launchAgentPath(home));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
