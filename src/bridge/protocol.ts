/**
 * OpenCode → 桌宠守护进程的桥协议（纯类型与常量，无副作用）。
 *
 * 协议版本独立于 app 版本：插件和守护进程可以各自升级，`protocol` 不等时
 * 由守护进程拒收并记日志，避免半懂不懂的事件把宠物状态弄乱。
 *
 * @module opencode-pet/src/bridge/protocol
 */

/** 当前桥协议版本。字段增删必须升版本。 */
export const BRIDGE_PROTOCOL = 1;

/** OpenCode 侧归一化后的事件名。 */
export type BridgeEventType =
  | 'session.execution.started'
  | 'session.execution.succeeded'
  | 'session.execution.failed'
  | 'session.execution.interrupted'
  | 'session.tool.input.started'
  | 'session.tool.called'
  | 'session.tool.success'
  | 'session.tool.failed'
  | 'permission.asked'
  | 'permission.replied'
  | 'session.text.ended'
  | 'session.idle'
  | 'session.meta';

/** 插件发来的一条事件；字段只带宠物需要的，不带完整消息体。 */
export interface BridgeEvent {
  /** 事件 id，用于去重。 */
  id: string;
  /** 事件名；未知值按忽略处理。 */
  type: BridgeEventType | string;
  /** 会话 id。 */
  sessionID: string;
  /** 会话标题（可选）。 */
  sessionTitle?: string;
  /** 父会话 id；非空表示子代理。 */
  parentID?: string | null;
  /** 事件时间戳（ms）。 */
  at: number;
  /** 事件负载。 */
  data?: Record<string, unknown>;
}

/** 交给 dsh-pet 宿主半侧的 DSH 会话形状。 */
export interface BridgeSession {
  id: string;
  title?: string;
  parentID?: string | null;
  /**
   * 宿主半侧只读 `header.id` / `header.origin` / `header.delegationDepth`。
   * 子代理必须把 origin 标成 `subagent`，否则完成通知会连子代理一起弹。
   */
  header: {
    id: string;
    origin?: 'subagent';
    delegationDepth?: number;
  };
}

/** dsh-pet 内部事件（与 DSH 的 `session/event` 同形状）。 */
export interface DshSessionEvent {
  type: string;
  data?: Record<string, unknown>;
}

/** 插件 hello：连接建立时发一次。 */
export interface HelloBody {
  protocol: number;
  pluginVersion: string;
  server?: { version?: string; url?: string };
  /** 启动时已知的会话标题/父子关系。 */
  sessions?: Array<{ id: string; title?: string; parentID?: string | null }>;
}

/** 桥接状态机：插件路由与心跳共用同一个实例（Task 6 实现）。 */
export interface BridgeLink {
  hello(body: HelloBody): { ok: true };
  events(body: { events: BridgeEvent[] }): { ok: true };
  bye(): { ok: true };
  tick(now: number): void;
  snapshot(): { connected: boolean; lastSeenAt: number | null; active: string[] };
}
