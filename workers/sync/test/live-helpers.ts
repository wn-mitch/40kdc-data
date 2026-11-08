/** Shared fixtures for the doc-bound live-room suites. */
import { expect } from "vitest";
import { env, SELF } from "cloudflare:test";
import { api, mintToken } from "./helpers";
import type { ServerMessage } from "../src/doc-protocol";

export const PLAN = { teamName: "Crusaders", size: 5, playersById: {}, playerOrder: [] };

/** Create a cloud doc and mint its share tokens. */
export async function makeSharedDoc(sub: string, payload: unknown = PLAN) {
  const token = await mintToken(sub);
  const created = await api("/docs", {
    method: "POST",
    token,
    body: { kind: "team-plan", name: "GT prep", payload },
  });
  expect(created.status).toBe(200);
  const id = created.body.id as string;
  const share = await api(`/docs/${id}/share`, { method: "POST", token });
  expect(share.status).toBe(200);
  return {
    token,
    id,
    createdAt: created.body.updated_at as number,
    editorToken: share.body.editorToken as string,
    viewerToken: share.body.viewerToken as string,
  };
}

/** Connect to a doc-bound room and collect messages; hello sent immediately. */
export async function connectDoc(id: string, linkToken: string, nickname: string) {
  const res = await SELF.fetch(`https://sync.test/docs/${id}/ws?token=${linkToken}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const queue: ServerMessage[] = [];
  const waiters: Array<(m: ServerMessage) => void> = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data as string) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  ws.accept();
  ws.send(JSON.stringify({ t: "hello", nickname, lastSeq: 0 }));
  function next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
      waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }
  return { ws, next };
}

/** A D1 stand-in that delegates to `real`, running `before(sql, call#)` ahead
 *  of each statement (to hold a write open or fail it). */
export function wrappedDb(
  real: D1Database,
  before: (sql: string, call: number) => Promise<void> | void,
): D1Database {
  let calls = 0;
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        const exec = async <T,>(fn: (s: D1PreparedStatement) => Promise<T>) => {
          await before(sql, calls++);
          return fn(real.prepare(sql).bind(...args));
        };
        return {
          run: () => exec((st) => st.run()),
          first: <T,>() => exec((st) => st.first<T>()),
        };
      },
    }),
  } as unknown as D1Database;
}

export function room(id: string) {
  return env.DOC_ROOM.get(env.DOC_ROOM.idFromName(`doc:${id}`));
}

export function registry() {
  return env.SYNC_REGISTRY.get(env.SYNC_REGISTRY.idFromName("global"));
}
