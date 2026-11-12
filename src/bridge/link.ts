/**
 * 桥接状态机：把插件推来的事件翻成 DSH 事件，并维护连接、active 会话与去重窗口。
 *
 * 不碰网络、不碰 Electron；时钟可注入，便于测试超时。
 * 约定：插件每 5s 发一次（哪怕 events 为空）心跳；15s 没有心跳就视为断开，
 * 对所有 active 会话补一条 aborted，让宠物回到空闲而不是永远卡在“工作中”。
 *
 * @module opencode-pet/src/bridge/link
 */
import type { BridgeEvent, BridgeLink, BridgeSession, HelloBody } from './protocol.ts';
import { translate } from './translate.ts';

/** 去重窗口大小。 */
const SEEN_LIMIT = 1000;
/** 委派链最大回溯深度，防止脏数据成环。 */
const DEPTH_LIMIT = 10;

interface LinkDeps {
  emit: (name: string, ...args: unknown[]) => void;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * 创建桥接状态机。
 *
 * @param deps - 事件出口、时钟与超时。
 */
export function createBridgeLink(deps: LinkDeps): BridgeLink {
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const titles = new Map<string, string>();
  const parents = new Map<string, string | null>();
  const seen = new Map<string, true>();
  const active = new Set<string>();
  let connected = false;
  let lastSeenAt: number | null = null;

  /** 会话在委派链里的深度（根为 0）。 */
  const depthOf = (sessionID: string): number => {
    let depth = 0;
    let current = parents.get(sessionID) ?? null;
    while (current && depth < DEPTH_LIMIT) {
      depth += 1;
      current = parents.get(current) ?? null;
    }
    return depth;
  };

  /** 造宿主半侧需要的会话形状。 */
  const sessionOf = (sessionID: string): BridgeSession => {
    const parentID = parents.get(sessionID) ?? null;
    const header: BridgeSession['header'] = { id: sessionID };
    if (parentID !== null) {
      header.origin = 'subagent';
      header.delegationDepth = depthOf(sessionID);
    }
    const title = titles.get(sessionID);
    return {
      id: sessionID,
      ...(title === undefined ? {} : { title }),
      ...(parentID === null ? {} : { parentID }),
      header,
    };
  };

  /** 把 active 会话全部收尾，并清空。 */
  const clearActive = (): void => {
    for (const sessionID of [...active]) {
      deps.emit('session/event', sessionOf(sessionID), {
        type: 'turn/end',
        data: { reason: { kind: 'aborted' } },
      });
    }
    active.clear();
  };

  /** 记录去重 id；超过窗口按插入顺序淘汰最旧的。 */
  const remember = (id: string): void => {
    seen.set(id, true);
    if (seen.size > SEEN_LIMIT) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  };

  return {
    hello(body: HelloBody) {
      connected = true;
      lastSeenAt = now();
      for (const session of body.sessions ?? []) {
        if (session.title !== undefined) titles.set(session.id, session.title);
        if (session.parentID !== undefined) parents.set(session.id, session.parentID);
      }
      return { ok: true };
    },

    events(body: { events: BridgeEvent[] }) {
      connected = true;
      lastSeenAt = now();
      for (const event of body.events) {
        if (seen.has(event.id)) continue;
        remember(event.id);
        if (event.sessionTitle !== undefined) titles.set(event.sessionID, event.sessionTitle);
        if (event.parentID !== undefined) parents.set(event.sessionID, event.parentID);
        if (event.type === 'session.meta') {
          const title = event.data?.title;
          if (typeof title === 'string') titles.set(event.sessionID, title);
        }
        // 事件本身可能不带 parentID（只有 hello / 之前的事件知道父子关系）：
        // 用已知映射补齐，translate 才能把子代理标出来。
        const enriched: BridgeEvent = {
          ...event,
          ...(event.parentID === undefined ? { parentID: parents.get(event.sessionID) ?? null } : {}),
          ...(event.sessionTitle === undefined && titles.has(event.sessionID)
            ? { sessionTitle: titles.get(event.sessionID) }
            : {}),
        };
        const translated = translate(enriched, depthOf);
        if (!translated) continue;
        // 每个产生状态变化的会话都进 active，不只 turn/start 的那些：
        // 插件可能在回合中途才接上（只看到 tool/call），这类条目原来永远等不到 turn/end，
        // 会永久占着展示槽（僵尸 working/thinking）。在 active 里，断连/bye 时能一并收尾。
        if (translated.event.type === 'turn/end') active.delete(event.sessionID);
        else active.add(event.sessionID);
        if (process.env.OPENCODE_PET_BRIDGE_DEBUG === '1')
          console.log('[bridge]', JSON.stringify({ session: translated.session, event: translated.event }));
        deps.emit('session/event', translated.session, translated.event);
      }
      return { ok: true };
    },

    bye() {
      clearActive();
      connected = false;
      lastSeenAt = null;
      return { ok: true };
    },

    tick(current: number) {
      if (!connected || lastSeenAt === null) return;
      if (current - lastSeenAt < timeoutMs) return;
      clearActive();
      connected = false;
    },

    snapshot() {
      return { connected, lastSeenAt, active: [...active] };
    },
  };
}
