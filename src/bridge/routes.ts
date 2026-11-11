/**
 * OpenCode 桥接的 HTTP 路由：hello / events / bye。
 *
 * 只做请求边界与分发：拒绝浏览器来源、限制 256KB、校验协议版本；业务状态在 BridgeLink 里。
 * 鉴权由宿主 router 的 `authorize` 在进入 handler 前完成（token 由 runtime.json 提供）。
 *
 * @module opencode-pet/src/bridge/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { RegisteredRoute } from '../standalone/context.ts';
import type { BridgeEvent, BridgeLink, HelloBody } from './protocol.ts';

/** 桥路由前缀（挂在原有插件路由段下，复用同一套令牌鉴权）。 */
export const BRIDGE_PREFIX = '/dsh-pet-7340/opencode-pet/bridge/v1';

/** 单次桥请求的正文上限。 */
export const MAX_BRIDGE_BYTES = 256 * 1024;

/** 协议版本。 */
const PROTOCOL = 1;

interface RouteDeps {
  link: BridgeLink;
  log: (message: string) => void;
}

/** 写 JSON 响应。 */
function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** 读取并解析 JSON 正文；超限/非法/为空分别给出状态码。 */
async function readJson(
  req: IncomingMessage,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; status: number }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BRIDGE_BYTES) return { ok: false, status: 413 };
    chunks.push(buffer);
  }
  if (size === 0) return { ok: false, status: 400 };
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, status: 400 };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** 校验 `protocol` 字段；缺失或不等都拒绝。 */
function protocolOk(body: Record<string, unknown>): boolean {
  return body.protocol === PROTOCOL;
}

/**
 * 造三条桥路由。
 *
 * @param deps - link 实例与日志出口。
 * @returns 可塞进 `routes` 数组的 exact 路由。
 */
export function createBridgeRoutes(deps: RouteDeps): RegisteredRoute[] {
  const route = (
    name: string,
    handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): RegisteredRoute => ({
    kind: 'exact',
    path: `${BRIDGE_PREFIX}/${name}`,
    handler: (req, res) => void handle(req, res),
  });

  /** 所有方法共用的前置检查。 */
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    // 桥只给 Node 插件用；任何浏览器来源（包括 file:// 的 null）都不该调它。
    if (req.headers.origin !== undefined) {
      send(res, 403, { ok: false, error: 'origin-not-allowed' });
      return false;
    }
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'method-not-allowed' });
      return false;
    }
    return true;
  };

  return [
    route('hello', async (req, res) => {
      if (!guard(req, res)) return;
      const parsed = await readJson(req);
      if (!parsed.ok) return send(res, parsed.status, { ok: false });
      if (!protocolOk(parsed.value)) return send(res, 400, { ok: false, error: 'protocol-mismatch' });
      deps.link.hello(parsed.value as unknown as HelloBody);
      send(res, 200, { ok: true });
    }),
    route('events', async (req, res) => {
      if (!guard(req, res)) return;
      const parsed = await readJson(req);
      if (!parsed.ok) return send(res, parsed.status, { ok: false });
      if (!protocolOk(parsed.value)) return send(res, 400, { ok: false, error: 'protocol-mismatch' });
      const events = parsed.value.events;
      if (!Array.isArray(events)) return send(res, 400, { ok: false, error: 'events-required' });
      deps.link.events({ events: events as BridgeEvent[] });
      send(res, 200, { ok: true });
    }),
    route('bye', async (req, res) => {
      if (!guard(req, res)) return;
      deps.link.bye();
      send(res, 200, { ok: true });
    }),
  ];
}
