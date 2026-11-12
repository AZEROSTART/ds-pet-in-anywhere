/**
 * 桥接状态机：心跳、超时回空闲、事件去重、子代理深度。
 *
 * 用可注入的时钟与 emit spy，不碰网络、不碰 Electron。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeLink } from './link.ts';
import type { BridgeEvent } from './protocol.ts';

let seq = 0;
function ev(type: string, sessionID = 's1', data: Record<string, unknown> = {}): BridgeEvent {
  seq += 1;
  return { id: `evt_${seq}`, type, sessionID, at: seq, data };
}

function harness() {
  const clock = { t: 1000 };
  const emitted: Array<{ session: unknown; event: { type: string; data?: Record<string, unknown> } }> = [];
  const link = createBridgeLink({
    emit: (_name, session, event) => emitted.push({ session, event: event as never }),
    now: () => clock.t,
    timeoutMs: 15_000,
  });
  return { clock, emitted, link };
}

const idleCount = (emitted: ReturnType<typeof harness>['emitted'], sessionID: string) =>
  emitted.filter(
    (item) =>
      item.event.type === 'turn/end' &&
      (item.event.data?.reason as { kind?: string } | undefined)?.kind === 'aborted' &&
      (item.session as { id: string }).id === sessionID,
  ).length;

describe('bridge link', () => {
  test('hello 后 connected，事件翻译并进入 active', () => {
    const { link, emitted } = harness();
    link.hello({ protocol: 1, pluginVersion: '0.1.0' });
    link.events({ events: [ev('session.execution.started')] });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.event.type, 'turn/start');
    assert.deepEqual(link.snapshot().active, ['s1']);
    assert.equal(link.snapshot().connected, true);
  });

  test('同一事件 id 只翻译一次', () => {
    const { link, emitted } = harness();
    const event = ev('session.execution.started');
    link.events({ events: [event, event] });
    assert.equal(emitted.length, 1);
  });

  test('心跳保持连接，超时对每个 active 会话只发一次空闲', () => {
    const { link, emitted, clock } = harness();
    link.hello({ protocol: 1, pluginVersion: '0.1.0' });
    link.events({ events: [ev('session.execution.started')] });
    clock.t += 10_000;
    link.tick(clock.t);
    assert.equal(link.snapshot().connected, true);
    clock.t += 6_000;
    link.tick(clock.t);
    assert.equal(link.snapshot().connected, false);
    assert.equal(idleCount(emitted, 's1'), 1);
    clock.t += 60_000;
    link.tick(clock.t);
    assert.equal(idleCount(emitted, 's1'), 1);
  });

  test('bye 清空 active 并各发一次空闲', () => {
    const { link, emitted } = harness();
    link.hello({ protocol: 1, pluginVersion: '0.1.0' });
    link.events({ events: [ev('session.execution.started', 's1'), ev('session.execution.started', 's2')] });
    link.bye();
    assert.deepEqual(link.snapshot().active, []);
    assert.equal(link.snapshot().connected, false);
    assert.equal(idleCount(emitted, 's1'), 1);
    assert.equal(idleCount(emitted, 's2'), 1);
  });

  test('子代理事件带上 delegation depth', () => {
    const { link, emitted } = harness();
    link.hello({
      protocol: 1,
      pluginVersion: '0.1.0',
      sessions: [
        { id: 'parent' },
        { id: 'child', parentID: 'parent' },
      ],
    });
    link.events({ events: [ev('session.execution.started', 'child')] });
    const session = emitted[0]?.session as { header: { origin?: string; delegationDepth?: number } };
    assert.equal(session.header.origin, 'subagent');
    assert.equal(session.header.delegationDepth, 1);
  });

  test('未知事件被忽略，不破坏 active', () => {
    const { link, emitted } = harness();
    link.hello({ protocol: 1, pluginVersion: '0.1.0' });
    link.events({ events: [ev('session.execution.started'), ev('session.usage.updated')] });
    assert.equal(emitted.length, 1);
    assert.deepEqual(link.snapshot().active, ['s1']);
  });

  test('中途接入的会话（没见过 turn/start）也进 active：bye/超时能清掉它的僵尸状态', () => {
    const { link, emitted } = harness();
    link.hello({ protocol: 1, pluginVersion: '0.1.0' });
    // 插件在回合中途加载：只看到 tool/call，没有 turn/start
    link.events({ events: [ev('session.tool.called', 's9', { name: 'bash', callId: 'c1' })] });
    assert.deepEqual(link.snapshot().active, ['s9']);
    link.bye();
    assert.deepEqual(link.snapshot().active, []);
    assert.equal(idleCount(emitted, 's9'), 1, '断连必须给它补一条 turn/end aborted');
  });

  test('去重窗口有界：超过 1000 条后最旧的 id 可再次被接受', () => {
    const { link, emitted } = harness();
    const first = ev('session.execution.started', 's1');
    link.events({ events: [first] });
    const bulk = Array.from({ length: 1005 }, (_, index) => ev('session.usage.updated', `bulk${index}`));
    link.events({ events: bulk });
    assert.equal(emitted.length, 1);
    // 最旧的 id 已被挤出窗口，再发一次应当被再次翻译。
    link.events({ events: [first] });
    assert.equal(emitted.length, 2);
  });
});
