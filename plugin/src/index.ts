/**
 * OpenCode server plugin 入口：订阅事件、归一化、推给本机宠物守护进程。
 *
 * 不渲染、不读写宠物配置；守护进程不在时静默重试，绝不阻塞 OpenCode。
 *
 * @module opencode-pet/plugin/index
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Plugin } from '@opencode/plugin';

import { createBridgeClient } from './client.ts';
import { createNormalizeState, normalize } from './normalize.ts';

/** 宠物数据目录（与守护进程同一口径）。 */
function petHome(): string {
  return process.env.OPENCODE_PET_HOME ?? join(homedir(), '.opencode-pet');
}

/** 心跳间隔：守护进程 15s 没收到就回空闲。 */
const HEARTBEAT_MS = 5_000;

export default Plugin.define({
  id: 'opencode-pet',
  setup(ctx) {
    const client = createBridgeClient({ home: petHome() });
    const state = createNormalizeState();
    const heartbeat = setInterval(() => client.send([]), HEARTBEAT_MS);
    heartbeat.unref?.();

    const run = async (): Promise<void> => {
      try {
        const sessions = await ctx.session.list();
        await client.hello(
          sessions.map((session) => ({
            id: session.id,
            ...(session.title === undefined ? {} : { title: session.title }),
            ...(session.parentID === undefined ? {} : { parentID: session.parentID }),
          })),
        );
      } catch {
        // 会话列表拿不到不影响事件流；标题会随后续 created/renamed 补齐。
      }
      for await (const event of ctx.event.subscribe()) {
        const normalized = normalize(event, state);
        if (normalized) client.send([normalized]);
      }
    };
    void run();

    return () => {
      clearInterval(heartbeat);
      void client.bye();
      client.dispose();
    };
  },
});
