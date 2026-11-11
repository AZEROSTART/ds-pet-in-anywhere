/**
 * 桥客户端：批量、运行时发现、失败重读、退出。
 *
 * 不碰真实网络：fetch 注入；runtime.json 写到临时目录。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBridgeClient } from './client.ts';
import type { BridgeEvent } from './normalize.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function event(id: string): BridgeEvent {
  return { id, type: 'session.execution.started', sessionID: 's1', at: 1 };
}

function runtime(home: string, port: number, token: string): void {
  writeFileSync(
    join(home, 'runtime.json'),
    JSON.stringify({ name: 'opencode-pet', version: '0.1.0', pid: 1, port, token, protocol: 1, startedAt: '' }),
  );
}

function fetchRecorder(responses: Array<{ ok: boolean }> = []) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string | undefined }> = [];
  let index = 0;
  const fetch = async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, headers: init.headers ?? {}, body: init.body });
    const response = responses[index] ?? { ok: true };
    index += 1;
    return { ok: response.ok, status: response.ok ? 200 : 500 };
  };
  return { calls, fetch };
}

describe('bridge client', () => {
  test('批量：两条事件合并成一次请求', async () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-plugin-'));
    try {
      runtime(home, 1111, 'tok');
      const { calls, fetch } = fetchRecorder();
      const client = createBridgeClient({ home, fetch, batchMs: 5, log: () => {} });
      client.send([event('e1')]);
      client.send([event('e2')]);
      await sleep(40);
      assert.equal(calls.length, 1);
      const body = JSON.parse(calls[0]!.body ?? '{}') as { events: BridgeEvent[] };
      assert.equal(body.events.length, 2);
      assert.equal(calls[0]!.headers['x-dsh-pet-token'], 'tok');
      assert.match(calls[0]!.url, /:1111\/dsh-pet-7340\/opencode-pet\/bridge\/v1\/events$/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('runtime 缺失：不发请求、不抛', async () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-plugin-'));
    try {
      const { calls, fetch } = fetchRecorder();
      const client = createBridgeClient({ home, fetch, batchMs: 1, log: () => {} });
      client.send([event('e1')]);
      await sleep(30);
      assert.equal(calls.length, 0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('连续 3 次失败后重读 runtime，使用新端口与令牌', async () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-plugin-'));
    try {
      runtime(home, 1111, 'old');
      const { calls, fetch } = fetchRecorder([{ ok: false }, { ok: false }, { ok: false }]);
      const client = createBridgeClient({ home, fetch, batchMs: 1, log: () => {} });
      client.send([event('e1')]);
      await sleep(20);
      client.send([event('e2')]);
      await sleep(20);
      client.send([event('e3')]);
      await sleep(20);
      runtime(home, 2222, 'new');
      client.send([event('e4')]);
      await sleep(30);
      assert.match(calls.at(-1)!.url, /:2222\//);
      assert.equal(calls.at(-1)!.headers['x-dsh-pet-token'], 'new');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('runtime 在启动后出现：下一次发送会重新读取并连接', async () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-plugin-'));
    try {
      const { calls, fetch } = fetchRecorder();
      const client = createBridgeClient({ home, fetch, batchMs: 1, log: () => {} });
      client.send([event('e1')]);
      await sleep(20);
      assert.equal(calls.length, 0);
      runtime(home, 3333, 'tok3');
      client.send([event('e2')]);
      await sleep(30);
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, /:3333\//);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('bye 发一次再 dispose，之后不再发请求', async () => {
    const home = mkdtempSync(join(tmpdir(), 'opencode-pet-plugin-'));
    try {
      runtime(home, 1111, 'tok');
      const { calls, fetch } = fetchRecorder();
      const client = createBridgeClient({ home, fetch, batchMs: 1, log: () => {} });
      await client.bye();
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, /\/bye$/);
      client.dispose();
      client.send([event('late')]);
      await sleep(20);
      assert.equal(calls.length, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
