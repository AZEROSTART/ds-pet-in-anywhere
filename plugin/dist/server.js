// src/index.ts
import { homedir } from "node:os";
import { join as join2 } from "node:path";
import { Plugin } from "@opencode/plugin";

// src/client.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
var PROTOCOL = 1;
var PREFIX = "/dsh-pet-7340/opencode-pet/bridge/v1";
var REREAD_AFTER = 3;
var MISSING_LOG_MS = 60000;
function createBridgeClient(options) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const batchMs = options.batchMs ?? 100;
  const log = options.log ?? (() => {});
  let runtime;
  let runtimeRead = false;
  let failures = 0;
  let lastMissingLog = 0;
  let queue = [];
  let wanted = false;
  let timer = null;
  let disposed = false;
  const readRuntime = () => {
    try {
      const value = JSON.parse(readFileSync(join(options.home, "runtime.json"), "utf8"));
      if (value && typeof value.port === "number" && typeof value.token === "string" && value.token !== "")
        return { port: value.port, token: value.token };
    } catch {}
    return;
  };
  const ensureRuntime = () => {
    if (!runtimeRead) {
      runtime = readRuntime();
      runtimeRead = runtime !== undefined;
    }
    if (!runtime) {
      if (now() - lastMissingLog > MISSING_LOG_MS) {
        lastMissingLog = now();
        log("opencode-pet daemon runtime not found; will retry");
      }
      return;
    }
    return runtime;
  };
  const post = async (path, body) => {
    const info = ensureRuntime();
    if (!info)
      return false;
    try {
      const response = await doFetch(`http://127.0.0.1:${info.port}${PREFIX}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-dsh-pet-token": info.token },
        ...body === undefined ? {} : { body: JSON.stringify(body) }
      });
      if (!response.ok)
        throw new Error(`status ${response.status}`);
      failures = 0;
      return true;
    } catch (error) {
      failures += 1;
      if (failures >= REREAD_AFTER) {
        failures = 0;
        runtime = undefined;
        runtimeRead = false;
      }
      log(`opencode-pet bridge ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  const flush = async () => {
    if (!wanted || disposed)
      return;
    wanted = false;
    const batch = queue;
    queue = [];
    await post("events", { protocol: PROTOCOL, events: batch });
  };
  const schedule = () => {
    if (timer || disposed)
      return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, batchMs);
    timer.unref?.();
  };
  return {
    send(events) {
      if (disposed)
        return;
      queue.push(...events);
      wanted = true;
      schedule();
    },
    async hello(sessions) {
      if (disposed)
        return;
      await post("hello", {
        protocol: PROTOCOL,
        pluginVersion: "0.1.0",
        sessions: sessions.map((session) => ({
          id: session.id,
          ...session.title === undefined ? {} : { title: session.title },
          ...session.parentID === undefined ? {} : { parentID: session.parentID }
        }))
      });
    },
    async bye() {
      if (disposed)
        return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
      await post("bye", { protocol: PROTOCOL });
      disposed = true;
    },
    dispose() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}

// src/normalize.ts
import { randomUUID } from "node:crypto";
function createNormalizeState() {
  return { titles: new Map, parents: new Map, toolNames: new Map };
}
function dataOf(event) {
  const value = event.data;
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function str(value) {
  return typeof value === "string" && value !== "" ? value : undefined;
}
function toolKey(sessionID, callID) {
  return `${sessionID}:${callID}`;
}
function normalize(event, state) {
  const data = dataOf(event);
  const sessionID = str(data.sessionID);
  if (!sessionID)
    return null;
  const base = () => ({
    id: str(event.id) ?? randomUUID(),
    type: event.type,
    sessionID,
    at: typeof event.created === "number" ? event.created : Date.now(),
    ...typeof event.durable?.seq === "number" ? { seq: event.durable.seq } : {},
    ...state.titles.has(sessionID) ? { sessionTitle: state.titles.get(sessionID) } : {},
    ...state.parents.has(sessionID) ? { parentID: state.parents.get(sessionID) } : {}
  });
  switch (event.type) {
    case "session.created": {
      const title = str(data.title);
      if (title)
        state.titles.set(sessionID, title);
      const parentID = data.parentID === null ? null : str(data.parentID);
      if (parentID !== undefined)
        state.parents.set(sessionID, parentID);
      return {
        ...base(),
        type: "session.meta",
        ...parentID === undefined ? {} : { parentID },
        data: { ...title === undefined ? {} : { title }, ...parentID === undefined ? {} : { parentID } }
      };
    }
    case "session.renamed": {
      const title = str(data.title);
      if (title)
        state.titles.set(sessionID, title);
      return { ...base(), type: "session.meta", data: title === undefined ? {} : { title } };
    }
    case "session.execution.started":
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return { ...base(), data: {} };
    case "session.execution.failed":
      return { ...base(), data: { error: data.error } };
    case "session.tool.input.started": {
      const callID = str(data.id);
      const name = str(data.name);
      if (callID && name)
        state.toolNames.set(toolKey(sessionID, callID), name);
      return null;
    }
    case "session.tool.called": {
      const callID = str(data.id);
      if (!callID)
        return null;
      const name = state.toolNames.get(toolKey(sessionID, callID)) ?? "tool";
      state.toolNames.delete(toolKey(sessionID, callID));
      return { ...base(), data: { name, callId: callID } };
    }
    case "session.tool.success":
    case "session.tool.failed": {
      const callID = str(data.id);
      return callID ? { ...base(), data: { callId: callID } } : null;
    }
    case "permission.asked":
      return {
        ...base(),
        data: { action: str(data.action), message: str(data.message) }
      };
    case "permission.replied":
      return { ...base(), data: {} };
    case "session.text.ended":
      return { ...base(), data: { text: str(data.text) ?? "" } };
    case "session.inbox.enqueued": {
      const item = data.item;
      const kind = item !== null && typeof item === "object" ? item.type : undefined;
      if (kind !== "user")
        return null;
      return { ...base(), type: "user.message", data: {} };
    }
    case "session.idle":
      return { ...base(), data: {} };
    default:
      return null;
  }
}

// src/index.ts
function petHome() {
  return process.env.OPENCODE_PET_HOME ?? join2(homedir(), ".opencode-pet");
}
var HEARTBEAT_MS = 5000;
var src_default = Plugin.define({
  id: "opencode-pet",
  setup(ctx) {
    const client = createBridgeClient({ home: petHome() });
    const state = createNormalizeState();
    const heartbeat = setInterval(() => client.send([]), HEARTBEAT_MS);
    heartbeat.unref?.();
    const run = async () => {
      try {
        const sessions = await ctx.session.list();
        await client.hello(sessions.map((session) => ({
          id: session.id,
          ...session.title === undefined ? {} : { title: session.title },
          ...session.parentID === undefined ? {} : { parentID: session.parentID }
        })));
      } catch {}
      for await (const event of ctx.event.subscribe()) {
        const normalized = normalize(event, state);
        if (normalized)
          client.send([normalized]);
      }
    };
    run();
    return () => {
      clearInterval(heartbeat);
      client.bye();
      client.dispose();
    };
  }
});
export {
  src_default as default
};
