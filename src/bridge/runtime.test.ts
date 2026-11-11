/**
 * 运行时发现文件：插件靠它找端口与令牌，坏了会让联动整体静默。
 * 契约：0600、原子写、只清理自己的文件、坏 JSON 不抛。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRuntime, runtimeFile, writeRuntime } from './runtime.ts';
import type { RuntimeInfo } from './runtime.ts';

const info = (patch: Partial<RuntimeInfo> = {}): RuntimeInfo => ({
  name: 'opencode-pet',
  version: '0.1.0',
  pid: 123,
  port: 4567,
  token: 'tok-a',
  protocol: 1,
  startedAt: '2026-11-11T00:00:00.000Z',
  ...patch,
});

describe('runtime 文件', () => {
  test('写入 0600 JSON，release 删除自己的文件', () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-runtime-'));
    try {
      const release = writeRuntime(home, info());
      assert.equal(statSync(runtimeFile(home)).mode & 0o777, 0o600);
      assert.deepEqual(readRuntime(home), info());
      release();
      assert.equal(existsSync(runtimeFile(home)), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('不删除另一个实例的文件', () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-runtime-'));
    try {
      const releaseA = writeRuntime(home, info({ pid: 1, token: 'a' }));
      writeRuntime(home, info({ pid: 2, token: 'b' }));
      releaseA();
      assert.equal(readRuntime(home)?.token, 'b');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('坏 JSON 读取返回 undefined，不抛', () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-runtime-'));
    try {
      writeFileSync(runtimeFile(home), '{not json', 'utf8');
      assert.equal(readRuntime(home), undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('缺少 port/token 的文件视为无效', () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-runtime-'));
    try {
      writeFileSync(runtimeFile(home), JSON.stringify({ pid: 1 }), 'utf8');
      assert.equal(readRuntime(home), undefined);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('文件内容包含 port 与 token', () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-runtime-'));
    try {
      writeRuntime(home, info());
      const raw = JSON.parse(readFileSync(runtimeFile(home), 'utf8')) as RuntimeInfo;
      assert.equal(raw.port, 4567);
      assert.equal(raw.token, 'tok-a');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
