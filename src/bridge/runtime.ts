/**
 * 运行时发现文件：守护进程把端口与令牌写到 `~/.opencode-pet/runtime.json`，
 * OpenCode 插件只读这个文件，不扫描端口、不猜地址。
 *
 * 权限 0600、原子写；清理时只删 pid + token 都匹配的那一份，避免两个实例互相误删。
 *
 * @module opencode-pet/src/bridge/runtime
 */
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { writePrivateJson } from '../standalone/ai-storage.ts';

/** 运行时发现信息。 */
export interface RuntimeInfo {
  name: 'opencode-pet';
  version: string;
  pid: number;
  port: number;
  token: string;
  protocol: 1;
  startedAt: string;
}

/** 运行时文件路径。 */
export function runtimeFile(home: string): string {
  return join(home, 'runtime.json');
}

/**
 * 写入运行时文件，返回幂等的清理函数。
 *
 * @param home - 宠物数据根（`~/.opencode-pet`）。
 * @param info - 端口、令牌与进程信息。
 * @returns 只清理自己这份文件的函数。
 */
export function writeRuntime(home: string, info: RuntimeInfo): () => void {
  mkdirSync(home, { recursive: true });
  const file = runtimeFile(home);
  writePrivateJson(file, info);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(readFileSync(file, 'utf8')) as Partial<RuntimeInfo>;
      if (current.pid === info.pid && current.token === info.token) unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  };
}

/**
 * 读取运行时文件；不存在、损坏或字段不全都返回 undefined，绝不抛。
 *
 * @param home - 宠物数据根。
 */
export function readRuntime(home: string): RuntimeInfo | undefined {
  try {
    const value = JSON.parse(readFileSync(runtimeFile(home), 'utf8')) as Partial<RuntimeInfo> | null;
    if (
      !value ||
      typeof value.port !== 'number' ||
      !Number.isInteger(value.port) ||
      value.port <= 0 ||
      typeof value.token !== 'string' ||
      value.token.length === 0 ||
      typeof value.pid !== 'number'
    )
      return undefined;
    return value as RuntimeInfo;
  } catch {
    return undefined;
  }
}
