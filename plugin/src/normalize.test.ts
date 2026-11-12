/**
 * OpenCode 事件 → 桥事件的归一化契约。
 *
 * 只转发宠物需要的字段；流式 delta、usage、provider 等一律丢弃。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createNormalizeState, normalize } from './normalize.ts';
import type { PluginEvent } from './normalize.ts';

let seq = 0;
function ev(type: string, data: Record<string, unknown> = {}): PluginEvent {
  seq += 1;
  return { id: `evt_${seq}`, type, created: 1000 + seq, data };
}

describe('normalize —— 会话生命周期', () => {
  test('execution.started 带 sessionID 与标题', () => {
    const state = createNormalizeState();
    const created = ev('session.created', { sessionID: 's1', title: 'fix login' });
    normalize(created, state);
    const result = normalize(ev('session.execution.started', { sessionID: 's1' }), state);
    assert.equal(result?.type, 'session.execution.started');
    assert.equal(result?.sessionID, 's1');
    assert.equal(result?.sessionTitle, 'fix login');
    assert.equal(typeof result?.at, 'number');
  });

  test('execution.failed 带 error', () => {
    const state = createNormalizeState();
    const result = normalize(ev('session.execution.failed', { sessionID: 's1', error: { message: 'boom' } }), state);
    assert.deepEqual(result?.data, { error: { message: 'boom' } });
  });

  test('renamed 更新标题并产出 session.meta', () => {
    const state = createNormalizeState();
    normalize(ev('session.created', { sessionID: 's1' }), state);
    const result = normalize(ev('session.renamed', { sessionID: 's1', title: 'new' }), state);
    assert.equal(result?.type, 'session.meta');
    assert.deepEqual(result?.data, { title: 'new' });
    assert.equal(state.titles.get('s1'), 'new');
  });

  test('created 带 parentID 时 meta 记下父子关系', () => {
    const state = createNormalizeState();
    const result = normalize(ev('session.created', { sessionID: 'child', parentID: 'parent' }), state);
    assert.equal(result?.type, 'session.meta');
    assert.deepEqual(result?.data, { parentID: 'parent' });
    assert.equal(state.parents.get('child'), 'parent');
  });
});

describe('normalize —— 工具', () => {
  test('input.started 记工具名，不单独发事件', () => {
    const state = createNormalizeState();
    const result = normalize(ev('session.tool.input.started', { sessionID: 's1', id: 'call_1', name: 'read' }), state);
    assert.equal(result, null);
    assert.equal(state.toolNames.get('s1:call_1'), 'read');
  });

  test('tool.called 带缓存的名字与 callId', () => {
    const state = createNormalizeState();
    normalize(ev('session.tool.input.started', { sessionID: 's1', id: 'call_1', name: 'read' }), state);
    const result = normalize(ev('session.tool.called', { sessionID: 's1', id: 'call_1' }), state);
    assert.deepEqual(result?.data, { name: 'read', callId: 'call_1' });
    assert.equal(state.toolNames.has('s1:call_1'), false);
  });

  test('没有 input.started 时 tool.called 回落到 tool', () => {
    const state = createNormalizeState();
    const result = normalize(ev('session.tool.called', { sessionID: 's1', id: 'call_2' }), state);
    assert.deepEqual(result?.data, { name: 'tool', callId: 'call_2' });
  });

  test('tool.success / failed 只带 callId', () => {
    const state = createNormalizeState();
    assert.deepEqual(normalize(ev('session.tool.success', { sessionID: 's1', id: 'c' }), state)?.data, { callId: 'c' });
    assert.deepEqual(normalize(ev('session.tool.failed', { sessionID: 's1', id: 'c' }), state)?.data, { callId: 'c' });
  });
});

describe('normalize —— 确认、正文与忽略项', () => {
  test('permission.asked 带 action 与 message', () => {
    const state = createNormalizeState();
    const result = normalize(ev('permission.asked', { sessionID: 's1', action: 'bash', message: 'run?' }), state);
    assert.deepEqual(result?.data, { action: 'bash', message: 'run?' });
  });

  test('session.text.ended 带正文', () => {
    const state = createNormalizeState();
    const result = normalize(ev('session.text.ended', { sessionID: 's1', text: 'done' }), state);
    assert.deepEqual(result?.data, { text: 'done' });
  });

  test('流式与全局事件被丢弃', () => {
    const state = createNormalizeState();
    assert.equal(normalize(ev('session.text.delta', { sessionID: 's1', delta: 'x' }), state), null);
    assert.equal(normalize(ev('session.usage.updated', { sessionID: 's1' }), state), null);
    assert.equal(normalize(ev('plugin.updated', {}), state), null);
  });

  test('缺 sessionID 的事件被丢弃', () => {
    const state = createNormalizeState();
    assert.equal(normalize(ev('session.idle', {}), state), null);
  });
});

describe('normalize —— 用户消息与事件序号', () => {
  test('inbox.enqueued（item.type=user）→ user.message', () => {
    const state = createNormalizeState();
    const result = normalize(
      ev('session.inbox.enqueued', { sessionID: 's1', inboxID: 'msg_1', item: { type: 'user', payload: {} } }),
      state,
    );
    assert.equal(result?.type, 'user.message');
    assert.equal(result?.sessionID, 's1');
  });

  test('inbox.enqueued（item.type=synthetic，自动续跑）不产生焦点事件', () => {
    const state = createNormalizeState();
    assert.equal(
      normalize(ev('session.inbox.enqueued', { sessionID: 's1', item: { type: 'synthetic', payload: {} } }), state),
      null,
    );
  });

  test('durable.seq 透传（宿主按它做最近优先排序）', () => {
    const state = createNormalizeState();
    const event = { ...ev('session.execution.started', { sessionID: 's1' }), durable: { seq: 17 } };
    assert.equal(normalize(event, state)?.seq, 17);
  });
});
