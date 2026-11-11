/**
 * OpenCode 2.2.7 提供给 server plugin 的最小类型面。
 *
 * 只声明本插件实际用到的成员；运行期由 OpenCode 宿主提供真实模块，
 * 构建时保持 external，不打包副本。
 */
declare module "@opencode/plugin" {
  export interface PluginEvent {
    readonly type: string;
    readonly [key: string]: unknown;
  }

  export interface PluginSessionInfo {
    readonly id: string;
    readonly title?: string;
    readonly parentID?: string | null;
  }

  export interface PluginContext {
    readonly event: {
      subscribe(options?: { readonly types?: readonly string[] }): AsyncIterable<PluginEvent>;
    };
    readonly session: {
      list(): Promise<readonly PluginSessionInfo[]>;
    };
  }

  export type PluginCleanup = () => Promise<void> | void;

  export interface PluginDefinition {
    readonly id: string;
    readonly setup: (context: PluginContext) => PluginCleanup | void | Promise<PluginCleanup | void>;
  }

  export const Plugin: {
    define(plugin: PluginDefinition): PluginDefinition;
  };
}
