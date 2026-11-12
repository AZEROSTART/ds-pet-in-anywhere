/**
 * OpenCode 桥事件 → dsh-pet 内部 DSH 事件的翻译契约。
 *
 * 为什么值得单独测：宿主半侧的 session-watch / notify-events 只认 DSH 事件，
 * 翻译错了不会崩，只会让宠物永远停在空闲或乱弹通知——最难查的一类坏法。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { translate } from './translate.ts';
import type { BridgeEvent } from './protocol.ts';

function ev(type: string, data: Record<string, unknown> = {}, extra: Partial<BridgeEvent> = {}): BridgeEvent {
  return { id: `evt_${type}`, type, sessionID: 's1', at: 1, data, ...extra };
}

const depth0 = () => 0;

describe('translate —— 会话生命周期', () => {
  test('execution.started -> turn/start', () => {
    assert.deepEqual(translate(ev('session.execution.started'), depth0)?.event, { type: 'turn/start', data: {} });
  });

  test('execution.succeeded -> turn/end completed', () => {
    assert.deepEqual(translate(ev('session.execution.succeeded'), depth0)?.event, {
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    });
  });

  test('execution.failed -> turn/end error with the error payload', () => {
    const result = translate(ev('session.execution.failed', { error: { message: 'boom' } }), depth0);
    assert.equal(result?.event.type, 'turn/end');
    assert.deepEqual(result?.event.data?.reason, { kind: 'error' });
    assert.deepEqual(result?.event.data?.error, { message: 'boom' });
  });

  test('execution.interrupted -> turn/end aborted', () => {
    assert.deepEqual(translate(ev('session.execution.interrupted'), depth0)?.event.data?.reason, { kind: 'aborted' });
  });

  test('session.idle -> turn/end idle', () => {
    assert.deepEqual(translate(ev('session.idle'), depth0)?.event.data?.reason, { kind: 'idle' });
  });

  test('session.text.ended -> assistant/message', () => {
    assert.deepEqual(translate(ev('session.text.ended', { text: 'hi' }), depth0)?.event, {
      type: 'assistant/message',
      data: { text: 'hi' },
    });
  });
});

describe('translate —— 工具与确认', () => {
  test('tool.called keeps name and call id', () => {
    const result = translate(ev('session.tool.called', { name: 'bash', callId: 'call_1' }), depth0);
    assert.deepEqual(result?.event, { type: 'tool/call', data: { name: 'bash', callId: 'call_1' } });
  });

  test('tool.success -> tool/result not an error', () => {
    assert.deepEqual(translate(ev('session.tool.success', { callId: 'call_1' }), depth0)?.event, {
      type: 'tool/result',
      data: { callId: 'call_1', isError: false },
    });
  });

  test('tool.failed -> tool/result with isError', () => {
    const result = translate(ev('session.tool.failed', { callId: 'call_1' }), depth0);
    assert.equal(result?.event.data?.isError, true);
  });

  test('permission.asked -> approval/asked（宿主读 toolName/reason）', () => {
    const result = translate(ev('permission.asked', { action: 'bash', message: 'run rm?' }), depth0);
    assert.deepEqual(result?.event, { type: 'approval/asked', data: { toolName: 'bash', reason: 'run rm?' } });
  });

  test('permission.replied -> approval/replied', () => {
    assert.equal(translate(ev('permission.replied'), depth0)?.event.type, 'approval/replied');
  });
});

describe('translate —— 会话元数据与子代理', () => {
  test('subagent session carries origin and delegation depth', () => {
    const result = translate(ev('session.execution.started', {}, { parentID: 'parent' }), () => 1);
    assert.equal(result?.session.header.origin, 'subagent');
    assert.equal(result?.session.header.delegationDepth, 1);
    assert.equal(result?.session.header.id, 's1');
  });

  test('top-level session has no subagent origin', () => {
    const result = translate(ev('session.execution.started'), depth0);
    assert.equal(result?.session.header.origin, undefined);
  });

  test('session title is carried through', () => {
    const result = translate(ev('session.execution.started', {}, { sessionTitle: 'fix login' }), depth0);
    assert.equal(result?.session.title, 'fix login');
  });

  test('session.meta only updates metadata, no DSH event', () => {
    assert.equal(translate(ev('session.meta', { title: 'x' }), depth0), null);
  });

  test('unknown type returns null', () => {
    assert.equal(translate(ev('session.usage.updated'), depth0), null);
  });
});

describe('translate —— 用户消息与事件序号', () => {
  test('user.message -> user/message（宿主据此锁定展示会话）', () => {
    assert.deepEqual(translate(ev('user.message'), depth0)?.event, { type: 'user/message', data: {} });
  });

  test('seq 透传到 DSH 事件顶层（宿主按它做最近优先的排序）', () => {
    const result = translate(ev('session.tool.called', { name: 'bash', callId: 'c1' }, { seq: 42 }), depth0);
    assert.equal(result?.event.seq, 42);
  });

  test('没有 seq 时不产生该字段（老插件照旧可用）', () => {
    const result = translate(ev('session.tool.called', { name: 'bash', callId: 'c1' }), depth0);
    assert.equal('seq' in (result?.event ?? {}), false);
  });
});
