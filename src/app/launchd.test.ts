/**
 * launchd 自启契约：plist 内容、`--launchd` 识别、安装/移除的文件副作用。
 * 不真的调用 launchctl：exec 注入。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LAUNCHD_LABEL, installLaunchAgent, isLaunchedByLaunchd, launchAgentInstalled, launchAgentPath, plistFor, removeLaunchAgent } from './launchd.ts';

const args = ['/Applications/OpenCode Pet.app/Contents/MacOS/OpenCode Pet', '--launchd'];

function recorder() {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const exec = async (file: string, args: readonly string[]) => {
    calls.push({ file, args });
  };
  return { calls, exec };
}

describe('launchd', () => {
  test('plist 带 label、RunAtLoad、crash-only KeepAlive 与参数', () => {
    const plist = plistFor(args);
    assert.match(plist, new RegExp(`<string>${LAUNCHD_LABEL}</string>`));
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.match(plist, /--launchd/);
    assert.match(plist, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  });

  test('识别 --launchd', () => {
    assert.equal(isLaunchedByLaunchd(args, {}), true);
    assert.equal(isLaunchedByLaunchd(['/x'], {}), false);
  });

  test('安装写 plist 并 bootstrap + kickstart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-launchd-'));
    try {
      const { calls, exec } = recorder();
      await installLaunchAgent(home, args, exec);
      assert.equal(existsSync(launchAgentPath(home)), true);
      assert.match(readFileSync(launchAgentPath(home), 'utf8'), /com\.opencode\.pet/);
      assert.equal(calls.length, 2);
      assert.equal(calls[0]?.file, 'launchctl');
      assert.equal(calls[0]?.args[0], 'bootstrap');
      assert.equal(calls[1]?.args[0], 'kickstart');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('移除删自己的 plist，保留其它文件', async () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-launchd-'));
    try {
      const { exec } = recorder();
      await installLaunchAgent(home, args, exec);
      const other = join(home, 'Library', 'LaunchAgents', 'other.plist');
      readFileSync(launchAgentPath(home));
      await import('node:fs').then((fs) => fs.writeFileSync(other, 'other'));
      await removeLaunchAgent(home, exec);
      assert.equal(launchAgentInstalled(home), false);
      assert.equal(existsSync(other), true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
