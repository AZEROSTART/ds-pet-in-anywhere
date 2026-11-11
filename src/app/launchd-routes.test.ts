/**
 * 开机启动开关路由：GET 状态、POST 切换、非法 body 拒绝。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createLaunchdRoutes } from './launchd-routes.ts';

async function withServer(run: (base: string, calls: string[], state: { installed: boolean }) => Promise<void>) {
  const calls: string[] = [];
  const state = { installed: true };
  const routes = createLaunchdRoutes({
    home: '/tmp/home',
    args: ['/app', '--launchd'],
    log: () => {},
    installed: () => state.installed,
    install: async (_home, args) => {
      calls.push(`install:${(args ?? []).join(',')}`);
      state.installed = true;
    },
    remove: async () => {
      calls.push('remove');
      state.installed = false;
    },
  });
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const route = routes.find((candidate) => candidate.path === new URL(req.url ?? '/', 'http://x').pathname);
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    void route.handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`, calls, state);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const url = '/dsh-pet-7340/launchd';

describe('launchd 路由', () => {
  test('GET 返回 installed', async () => {
    await withServer(async (base) => {
      const res = await fetch(base + url);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { installed: true });
    });
  });

  test('POST enabled=false 调用 remove', async () => {
    await withServer(async (base, calls) => {
      const res = await fetch(base + url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(calls, ['remove']);
      assert.deepEqual(await res.json(), { ok: true, installed: false });
    });
  });

  test('POST 非法 body 返回 400', async () => {
    await withServer(async (base, calls) => {
      const res = await fetch(base + url, { method: 'POST', body: JSON.stringify({ enabled: 'yes' }) });
      assert.equal(res.status, 400);
      assert.deepEqual(calls, []);
    });
  });
});
