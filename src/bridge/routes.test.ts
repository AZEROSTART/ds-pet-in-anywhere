/**
 * 桥路由的 HTTP 边界：拒绝浏览器来源、限制正文、非法 JSON 不落地。
 * 鉴权（token）由宿主 router 的 authorize 前置完成，这里只测本模块自己的边界。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createBridgeRoutes } from './routes.ts';
import type { BridgeLink } from './protocol.ts';

function fakeLink() {
  const calls = { hello: 0, events: 0, bye: 0 };
  const link: BridgeLink = {
    hello: () => {
      calls.hello += 1;
      return { ok: true };
    },
    events: () => {
      calls.events += 1;
      return { ok: true };
    },
    bye: () => {
      calls.bye += 1;
      return { ok: true };
    },
    tick: () => {},
    snapshot: () => ({ connected: false, lastSeenAt: null, active: [] }),
  };
  return { link, calls };
}

async function withServer(
  run: (base: string, calls: ReturnType<typeof fakeLink>['calls']) => Promise<void>,
): Promise<void> {
  const { link, calls } = fakeLink();
  const routes = createBridgeRoutes({ link, log: () => {} });
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
    await run(`http://127.0.0.1:${port}`, calls);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const eventsUrl = '/dsh-pet-7340/opencode-pet/bridge/v1/events';

describe('桥路由', () => {
  test('带 Origin 的浏览器请求一律 403', async () => {
    await withServer(async (base, calls) => {
      const res = await fetch(base + eventsUrl, {
        method: 'POST',
        headers: { origin: 'http://evil.test', 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: 1, events: [] }),
      });
      assert.equal(res.status, 403);
      assert.equal(calls.events, 0);
    });
  });

  test('合法批次返回 200 并调用 link.events', async () => {
    await withServer(async (base, calls) => {
      const res = await fetch(base + eventsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: 1, events: [] }),
      });
      assert.equal(res.status, 200);
      assert.equal(calls.events, 1);
    });
  });

  test('超过 256KB 的正文返回 413', async () => {
    await withServer(async (base, calls) => {
      const res = await fetch(base + eventsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: 1, events: [], pad: 'x'.repeat(300 * 1024) }),
      });
      assert.equal(res.status, 413);
      assert.equal(calls.events, 0);
    });
  });

  test('非法 JSON 返回 400', async () => {
    await withServer(async (base, calls) => {
      const res = await fetch(base + eventsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      assert.equal(res.status, 400);
      assert.equal(calls.events, 0);
    });
  });

  test('协议版本不匹配返回 400', async () => {
    await withServer(async (base, calls) => {
      const res = await fetch(base + eventsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: 999, events: [] }),
      });
      assert.equal(res.status, 400);
      assert.equal(calls.events, 0);
    });
  });
});
