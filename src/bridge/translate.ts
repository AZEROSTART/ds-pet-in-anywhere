/**
 * OpenCode 桥事件 → dsh-pet 内部 DSH 事件的翻译。
 *
 * 只做纯函数映射：不读时间、不读环境、不持有状态。子代理的深度由调用方传入，
 * 这样同一份翻译可以在测试里用固定深度，也可以在守护进程里用会话链计算。
 *
 * @module opencode-pet/src/bridge/translate
 */
import type { BridgeEvent, BridgeSession, DshSessionEvent } from './protocol.ts';

/** 翻译结果：宿主半侧 `on('session/event')` 需要的两个实参。 */
export interface TranslatedEvent {
  session: BridgeSession;
  event: DshSessionEvent;
}

/** 取可选字符串负载。 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * 把一条桥事件翻译成 DSH 事件。
 *
 * @param event - 插件发来的事件。
 * @param depthOf - 会话在委派链里的深度（根会话为 0）。
 * @returns 翻译结果；未知事件或纯元数据返回 null。
 */
export function translate(event: BridgeEvent, depthOf: (sessionID: string) => number): TranslatedEvent | null {
  const data = event.data ?? {};
  const dsh = dshEventOf(event, data);
  if (!dsh) return null;

  const header: BridgeSession['header'] = { id: event.sessionID };
  if (event.parentID !== null && event.parentID !== undefined) {
    header.origin = 'subagent';
    header.delegationDepth = depthOf(event.sessionID);
  }

  return {
    session: {
      id: event.sessionID,
      ...(event.sessionTitle === undefined ? {} : { title: event.sessionTitle }),
      ...(event.parentID === undefined ? {} : { parentID: event.parentID }),
      header,
    },
    event: dsh,
  };
}

/** 事件名 → DSH 事件；未知返回 null。 */
function dshEventOf(event: BridgeEvent, data: Record<string, unknown>): DshSessionEvent | null {
  switch (event.type) {
    case 'session.execution.started':
      return { type: 'turn/start', data: {} };
    case 'session.execution.succeeded':
      return { type: 'turn/end', data: { reason: { kind: 'completed' } } };
    case 'session.execution.failed':
      return { type: 'turn/end', data: { reason: { kind: 'error' }, error: data.error } };
    case 'session.execution.interrupted':
      return { type: 'turn/end', data: { reason: { kind: 'aborted' } } };
    case 'session.idle':
      return { type: 'turn/end', data: { reason: { kind: 'idle' } } };
    case 'session.tool.input.started':
    case 'session.tool.called':
      return {
        type: 'tool/call',
        data: { name: text(data.name) ?? 'tool', callId: text(data.callId) ?? text(data.id) },
      };
    case 'session.tool.success':
      return { type: 'tool/result', data: { callId: text(data.callId) ?? text(data.id), isError: false } };
    case 'session.tool.failed':
      return { type: 'tool/result', data: { callId: text(data.callId) ?? text(data.id), isError: true } };
    case 'permission.asked':
      return {
        type: 'approval/asked',
        // 宿主 notify-events 读的是 toolName / reason。
        data: { toolName: text(data.action), reason: text(data.message) },
      };
    case 'permission.replied':
      return { type: 'approval/replied', data: {} };
    case 'session.text.ended':
      return { type: 'assistant/message', data: { text: text(data.text) ?? '' } };
    case 'session.meta':
      return null;
    default:
      return null;
  }
}
