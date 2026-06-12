/**
 * Live doc-session wire protocol (DocRoom ⇄ clients).
 *
 * Replication model: the server holds the authoritative JSON document,
 * applies total-ordered op batches, and sends the FULL document on welcome —
 * docs are small (≤256 KB, typically a few KB), so late-join and reconnect
 * are always exact and there is no checkpoint/digest machinery (the part of
 * shadowboxing's protocol that exists only because its state lives in a WASM
 * world the server can't evaluate).
 *
 * Ops are path-scoped (object keys / array indices), so edits to disjoint
 * subtrees commute under the server order; same-path collisions degrade to
 * last-write-wins at path granularity. Domain layers should address rows by
 * stable ids (id-keyed objects) and reserve `splice` for explicit
 * add/remove/reorder gestures.
 *
 * `hello.lastSeq` is carried so a bounded op-log tail replay can be added
 * later without a protocol change; today the server always answers with a
 * fresh welcome.
 */

export type PathSeg = string | number;

export type DocOp =
  | { o: "set"; p: PathSeg[]; v: unknown }
  | { o: "del"; p: PathSeg[] }
  | { o: "splice"; p: PathSeg[]; i: number; d: number; ins: unknown[] };

/** Structural limits the server enforces per op batch. */
export const MAX_OPS_PER_BATCH = 64;
export const MAX_PATH_DEPTH = 16;

export interface Participant {
  id: string;
  nickname: string;
  role: "editor" | "viewer";
}

export type ClientMessage =
  | { t: "hello"; nickname?: string; lastSeq: number }
  | { t: "nick"; nickname: string }
  | { t: "op"; clientSeq: number; ops: DocOp[] };

export type ServerMessage =
  | {
      t: "welcome";
      participantId: string;
      role: "editor" | "viewer";
      kind: string;
      /** Doc name (doc-bound rooms only — ephemeral sessions have none). */
      name?: string;
      doc: unknown;
      seq: number;
      participants: Participant[];
    }
  | { t: "op"; seq: number; ops: DocOp[]; from: string }
  | { t: "ack"; clientSeq: number; seq: number }
  | { t: "presence"; participants: Participant[] }
  | { t: "error"; code: string; message: string };
