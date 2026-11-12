/**
 * OpenCode 事件 → opencode-pet 桥事件。
 *
 * 只保留宠物需要的字段：会话 id/标题/父子关系、工具名与 call id、确认动作、回复正文、用户消息。
 * 流式 delta、usage、provider/model/plugin 等全局事件一律丢弃，避免把大 payload 发给守护进程。
 *
 * @module opencode-pet/plugin/normalize
 */
import { randomUUID } from 'node:crypto';

/** OpenCode 发来的原始事件（只约束真正读取的字段）。 */
export interface PluginEvent {
  readonly type: string;
  /** 同一会话内的单调序号；透传给宿主做「同档位取最近」的排序。 */
  readonly durable?: { readonly seq?: unknown };
  readonly [key: string]: unknown;
}

/** 桥事件；字段名必须与守护进程 `src/bridge/protocol.ts` 的 BridgeEvent 一致。 */
export interface BridgeEvent {
  id: string;
  type: string;
  sessionID: string;
  sessionTitle?: string;
  parentID?: string | null;
  at: number;
  /** OpenCode 的 `durable.seq`（ms 时间戳之外的第二排序依据，缺省不出现）。 */
  seq?: number;
  data?: Record<string, unknown>;
}

/** 归一化过程中跨事件维护的元数据。 */
export interface NormalizeState {
  readonly titles: Map<string, string>;
  readonly parents: Map<string, string | null>;
  readonly toolNames: Map<string, string>;
}

/** 造一份空的归一化状态。 */
export function createNormalizeState(): NormalizeState {
  return { titles: new Map(), parents: new Map(), toolNames: new Map() };
}

/** 取 `data` 对象；缺失或不是对象时给空对象。 */
function dataOf(event: PluginEvent): Record<string, unknown> {
  const value = event.data;
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 取字符串；否则 undefined。 */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** 工具名缓存键：同一会话内 call id 唯一。 */
function toolKey(sessionID: string, callID: string): string {
  return `${sessionID}:${callID}`;
}

/**
 * 归一化一条事件。
 *
 * @param event - OpenCode 事件。
 * @param state - 跨事件元数据（标题、父子关系、工具名）。
 * @returns 桥事件；不需要转发的返回 null。
 */
export function normalize(event: PluginEvent, state: NormalizeState): BridgeEvent | null {
  const data = dataOf(event);
  const sessionID = str(data.sessionID);
  if (!sessionID) return null;

  const base = (): BridgeEvent => ({
    id: str(event.id) ?? randomUUID(),
    type: event.type,
    sessionID,
    at: typeof event.created === 'number' ? event.created : Date.now(),
    ...(typeof event.durable?.seq === 'number' ? { seq: event.durable.seq } : {}),
    ...(state.titles.has(sessionID) ? { sessionTitle: state.titles.get(sessionID) } : {}),
    ...(state.parents.has(sessionID) ? { parentID: state.parents.get(sessionID) } : {}),
  });

  switch (event.type) {
    case 'session.created': {
      const title = str(data.title);
      if (title) state.titles.set(sessionID, title);
      const parentID = data.parentID === null ? null : str(data.parentID);
      if (parentID !== undefined) state.parents.set(sessionID, parentID);
      return {
        ...base(),
        type: 'session.meta',
        ...(parentID === undefined ? {} : { parentID }),
        data: { ...(title === undefined ? {} : { title }), ...(parentID === undefined ? {} : { parentID }) },
      };
    }
    case 'session.renamed': {
      const title = str(data.title);
      if (title) state.titles.set(sessionID, title);
      return { ...base(), type: 'session.meta', data: title === undefined ? {} : { title } };
    }
    case 'session.execution.started':
    case 'session.execution.succeeded':
    case 'session.execution.interrupted':
      return { ...base(), data: {} };
    case 'session.execution.failed':
      return { ...base(), data: { error: data.error } };
    case 'session.tool.input.started': {
      const callID = str(data.id);
      const name = str(data.name);
      if (callID && name) state.toolNames.set(toolKey(sessionID, callID), name);
      return null;
    }
    case 'session.tool.called': {
      const callID = str(data.id);
      if (!callID) return null;
      const name = state.toolNames.get(toolKey(sessionID, callID)) ?? 'tool';
      state.toolNames.delete(toolKey(sessionID, callID));
      return { ...base(), data: { name, callId: callID } };
    }
    case 'session.tool.success':
    case 'session.tool.failed': {
      const callID = str(data.id);
      return callID ? { ...base(), data: { callId: callID } } : null;
    }
    case 'permission.asked':
      return {
        ...base(),
        data: { action: str(data.action), message: str(data.message) },
      };
    case 'permission.replied':
      return { ...base(), data: {} };
    case 'session.text.ended':
      return { ...base(), data: { text: str(data.text) ?? '' } };
    case 'session.inbox.enqueued': {
      // 只认用户亲口发的消息（item.type=user）：自动续跑/合成项（synthetic）不算焦点，
      // 否则后台自动轮会把桌宠从你手上抢走。
      const item = data.item;
      const kind = item !== null && typeof item === 'object' ? (item as { type?: unknown }).type : undefined;
      if (kind !== 'user') return null;
      return { ...base(), type: 'user.message', data: {} };
    }
    case 'session.idle':
      return { ...base(), data: {} };
    default:
      return null;
  }
}
