/**
 * 托盘/设置页使用的开机启动开关：`GET/POST /dsh-pet-7340/launchd`。
 *
 * 鉴权由宿主 router 的 authorize 前置完成；这里只做方法、JSON 与开关分发。
 *
 * @module opencode-pet/src/app/launchd-routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { RegisteredRoute } from '../standalone/context.ts';
import {
  installLaunchAgent,
  launchAgentInstalled,
  removeLaunchAgent,
} from './launchd.ts';

const PATH = '/dsh-pet-7340/launchd';

interface RouteDeps {
  home: string;
  args: string[];
  log: (message: string) => void;
  install?: typeof installLaunchAgent;
  remove?: typeof removeLaunchAgent;
  installed?: typeof launchAgentInstalled;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 4096) return undefined;
    chunks.push(buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 造开机启动开关路由。
 *
 * @param deps - home、launchd 参数与可注入的实现（测试）。
 */
export function createLaunchdRoutes(deps: RouteDeps): RegisteredRoute[] {
  const installed = deps.installed ?? launchAgentInstalled;
  const install = deps.install ?? installLaunchAgent;
  const remove = deps.remove ?? removeLaunchAgent;

  return [
    {
      kind: 'exact',
      path: PATH,
      handler: (req, res) => {
        void (async () => {
          if (req.method === 'GET') {
            send(res, 200, { installed: installed(deps.home) });
            return;
          }
          if (req.method !== 'POST') {
            send(res, 405, { ok: false });
            return;
          }
          const body = await readJson(req);
          if (!body || typeof body.enabled !== 'boolean') {
            send(res, 400, { ok: false, error: 'enabled-required' });
            return;
          }
          try {
            if (body.enabled) await install(deps.home, deps.args);
            else await remove(deps.home);
            send(res, 200, { ok: true, installed: installed(deps.home) });
          } catch (error) {
            deps.log(`launchd 开关失败：${error instanceof Error ? error.message : String(error)}`);
            send(res, 500, { ok: false, error: 'launchd-failed' });
          }
        })();
      },
    },
  ];
}
