/**
 * 桥客户端：读 `~/.opencode-pet/runtime.json`，把归一化事件批量 POST 给守护进程。
 *
 * 失败不阻塞 OpenCode：丢弃本批、记日志；连续 3 次失败后清掉 runtime 缓存，
 * 下次重读（守护进程重启会换端口与令牌）。
 *
 * @module opencode-pet/plugin/client
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BridgeEvent } from './normalize.ts';

/** 桥协议版本，必须与守护进程一致。 */
const PROTOCOL = 1;
/** 守护进程桥路由前缀。 */
const PREFIX = '/dsh-pet-7340/opencode-pet/bridge/v1';
/** 连续失败多少次后重读 runtime。 */
const REREAD_AFTER = 3;
/** runtime 缺失日志的最小间隔。 */
const MISSING_LOG_MS = 60_000;

/** 可注入的 fetch 形状（只用到 bridge 需要的部分）。 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number }>;

/** 桥客户端。 */
export interface BridgeClient {
  /** 入队事件；100ms 内的多条会合成一批。 */
  send(events: BridgeEvent[]): void;
  /** 连接建立时发一次 hello（尽力而为）。 */
  hello(sessions: ReadonlyArray<{ id: string; title?: string; parentID?: string | null }>): Promise<void>;
  /** 先冲刷队列，再发 bye。 */
  bye(): Promise<void>;
  /** 停止后续发送。 */
  dispose(): void;
}

/** 客户端选项。 */
export interface BridgeClientOptions {
  home: string;
  fetch?: FetchLike;
  now?: () => number;
  batchMs?: number;
  log?: (message: string) => void;
}

interface Runtime {
  port: number;
  token: string;
}

/**
 * 创建桥客户端。
 *
 * @param options - 数据目录、fetch/时钟注入与批量窗口。
 */
export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const now = options.now ?? (() => Date.now());
  const batchMs = options.batchMs ?? 100;
  const log = options.log ?? (() => {});
  let runtime: Runtime | undefined;
  let runtimeRead = false;
  let failures = 0;
  let lastMissingLog = 0;
  let queue: BridgeEvent[] = [];
  let wanted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  /** 读 runtime；损坏/缺失返回 undefined。 */
  const readRuntime = (): Runtime | undefined => {
    try {
      const value = JSON.parse(readFileSync(join(options.home, 'runtime.json'), 'utf8')) as Partial<Runtime> | null;
      if (value && typeof value.port === 'number' && typeof value.token === 'string' && value.token !== '')
        return { port: value.port, token: value.token };
    } catch {
      /* 缺失/损坏：按未就绪处理 */
    }
    return undefined;
  };

  /** 懒读 runtime；缺失时按分钟节流记日志。 */
  const ensureRuntime = (): Runtime | undefined => {
    if (!runtimeRead) {
      runtime = readRuntime();
      // 只有读到有效文件才记住；否则下次继续重读（宠物可能稍后才启动）。
      runtimeRead = runtime !== undefined;
    }
    if (!runtime) {
      if (now() - lastMissingLog > MISSING_LOG_MS) {
        lastMissingLog = now();
        log('opencode-pet daemon runtime not found; will retry');
      }
      return undefined;
    }
    return runtime;
  };

  /** 发送一次请求；失败按连续次数决定是否重读 runtime。 */
  const post = async (path: string, body: unknown): Promise<boolean> => {
    const info = ensureRuntime();
    if (!info) return false;
    try {
      const response = await doFetch(`http://127.0.0.1:${info.port}${PREFIX}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-pet-token': info.token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      failures = 0;
      return true;
    } catch (error) {
      failures += 1;
      if (failures >= REREAD_AFTER) {
        failures = 0;
        runtime = undefined;
        runtimeRead = false;
      }
      log(`opencode-pet bridge ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  /** 冲刷队列；空队列也发（心跳）。 */
  const flush = async (): Promise<void> => {
    if (!wanted || disposed) return;
    wanted = false;
    const batch = queue;
    queue = [];
    await post('events', { protocol: PROTOCOL, events: batch });
  };

  /** 安排一次批量冲刷。 */
  const schedule = (): void => {
    if (timer || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, batchMs);
    timer.unref?.();
  };

  return {
    send(events) {
      if (disposed) return;
      queue.push(...events);
      wanted = true;
      schedule();
    },
    async hello(sessions) {
      if (disposed) return;
      await post('hello', {
        protocol: PROTOCOL,
        pluginVersion: '0.1.0',
        sessions: sessions.map((session) => ({
          id: session.id,
          ...(session.title === undefined ? {} : { title: session.title }),
          ...(session.parentID === undefined ? {} : { parentID: session.parentID }),
        })),
      });
    },
    async bye() {
      if (disposed) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
      await post('bye', { protocol: PROTOCOL });
      disposed = true;
    },
    dispose() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
