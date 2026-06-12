/**
 * DocRoom — one live shared-editing session over one JSON document (a team
 * plan or an army list), mirroring shadowboxing's SessionRoom seq/ack shape
 * but doc-generic and deliberately simpler: the room itself holds and
 * mutates the authoritative document, so a welcome always carries the exact
 * full doc (no client checkpoints, no digest/heal machinery).
 *
 * Two modes share the message loop:
 *
 *  - EPHEMERAL (`?session=` invite links): POST /session creates the room
 *    seeded with the creator's current doc and returns role-scoped link
 *    tokens stored in room meta. The doc lives and dies with the room.
 *
 *  - DOC-BOUND (`?d=<docId>` live doc links): the room IS a cloud document's
 *    live presence. Share tokens live on the D1 row (read fresh on every
 *    join, so regeneration applies to all new joins instantly); the first
 *    join hydrates the room from D1 and acquires the registry slot, and
 *    edits persist back debounced (DOC_PERSIST_SECONDS), on last-leave, and
 *    at idle eviction — D1 stays the durable home.
 *
 * Clients connect over WebSocket with a token, say hello, and get a welcome
 * (full doc + seq). Editor op batches are validated + applied server-side
 * under a total order: the sender gets an ack, everyone else gets the ops.
 * Any rejected batch tells the client to hard-resync (reconnect → welcome).
 *
 * Uses the WebSocket hibernation API so an idle-but-connected room costs
 * nothing between messages; an alarm evicts rooms idle past the TTL and
 * releases their registry slot.
 */
import { DurableObject } from "cloudflare:workers";
import { applyDocOps, OpError } from "./apply-ops";
import type { ClientMessage, Participant, ServerMessage } from "./doc-protocol";
import type { SyncRegistry, SyncRegistryEnv } from "./sync-registry";

export interface DocRoomEnv extends SyncRegistryEnv {
  SYNC_REGISTRY: DurableObjectNamespace<SyncRegistry>;
  DB: D1Database;
  MAX_EDITORS?: string;
  MAX_VIEWERS?: string;
  MAX_PAYLOAD_BYTES?: string;
  DOC_PERSIST_SECONDS?: string;
}

const DEFAULT_MAX_EDITORS = 10;
const DEFAULT_MAX_VIEWERS = 20;
const DEFAULT_TTL_MINUTES = 120;
/** Debounce window for writing a doc-bound room's edits back to D1. */
const DEFAULT_PERSIST_SECONDS = 15;
/** Same cap the worker enforces on PUT bodies — a live room must never grow
 *  a doc it couldn't persist. */
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_NICKNAME_LEN = 40;

/** Per-socket state, persisted via serializeAttachment so it survives
 *  hibernation. */
interface SocketInfo {
  participantId: string;
  nickname: string;
  role: "editor" | "viewer";
  /** Welcome sent (hello received) — ops are ignored before that. */
  ready: boolean;
}

export class DocRoom extends DurableObject<DocRoomEnv> {
  constructor(ctx: DurableObjectState, env: DocRoomEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
      `);
    });
  }

  private readMeta(k: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k)
      .toArray()[0];
    return row ? row.v : null;
  }

  private writeMeta(k: string, v: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      k,
      v,
    );
  }

  private ttlMs(): number {
    return Number(this.env.DOC_SESSION_TTL_MINUTES ?? DEFAULT_TTL_MINUTES) * 60_000;
  }

  private persistMs(): number {
    return Number(this.env.DOC_PERSIST_SECONDS ?? DEFAULT_PERSIST_SECONDS) * 1000;
  }

  private maxPayloadBytes(): number {
    return Number(this.env.MAX_PAYLOAD_BYTES ?? DEFAULT_MAX_PAYLOAD_BYTES);
  }

  private touch(): void {
    this.writeMeta("last_activity", String(Date.now()));
  }

  private registry(): DurableObjectStub<SyncRegistry> {
    return this.env.SYNC_REGISTRY.get(this.env.SYNC_REGISTRY.idFromName("global"));
  }

  /** The key this room registered under: doc-bound rooms use `doc:<id>` (the
   *  worker's doc_live check looks them up by it), ephemeral rooms their code. */
  private registryKey(): string | null {
    const docId = this.readMeta("doc_id");
    if (docId !== null) return `doc:${docId}`;
    return this.readMeta("code");
  }

  /** Initialize the room (idempotent guard: a second init on a live code is
   *  refused so a code collision can't clobber a session). Returns the
   *  role-scoped connect tokens. */
  async init(
    code: string,
    kind: string,
    doc: unknown,
  ): Promise<{ editorToken: string; viewerToken: string } | null> {
    if (this.readMeta("code") !== null) return null;
    const editorToken = crypto.randomUUID();
    const viewerToken = crypto.randomUUID();
    this.writeMeta("code", code);
    this.writeMeta("kind", kind);
    this.writeMeta("doc", JSON.stringify(doc));
    this.writeMeta("seq", "0");
    this.writeMeta("editor_token", editorToken);
    this.writeMeta("viewer_token", viewerToken);
    this.touch();
    await this.ctx.storage.setAlarm(Date.now() + this.ttlMs());
    return { editorToken, viewerToken };
  }

  /** WebSocket upgrade (?token=…). The worker routes /session/:code/ws here,
   *  and /docs/:id/ws with a server-set `?doc=<id>` (doc-bound mode). */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const url = new URL(request.url);
    const docId = url.searchParams.get("doc");
    const token = url.searchParams.get("token") ?? "";

    let role: "editor" | "viewer" | null;
    if (docId !== null) {
      // Doc-bound: tokens live on the D1 row — one indexed point read both
      // validates the token and (when cold) hydrates the room.
      const row = await this.env.DB.prepare(
        "SELECT kind, name, payload, editor_token, viewer_token FROM documents WHERE id = ?",
      )
        .bind(docId)
        .first<{
          kind: string;
          name: string;
          payload: string;
          editor_token: string | null;
          viewer_token: string | null;
        }>();
      if (!row) return new Response("no such document", { status: 404 });
      role =
        token && row.editor_token && token === row.editor_token
          ? "editor"
          : token && row.viewer_token && token === row.viewer_token
            ? "viewer"
            : null;
      if (!role) return new Response("bad token", { status: 403 });
      if (this.readMeta("doc_id") === null) {
        // First join brings the doc live — it must win a registry slot.
        if (!(await this.registry().tryAcquire(`doc:${docId}`))) {
          return new Response("at capacity", { status: 503 });
        }
        this.writeMeta("doc_id", docId);
        this.writeMeta("kind", row.kind);
        this.writeMeta("name", row.name);
        this.writeMeta("doc", row.payload);
        this.writeMeta("seq", "0");
        this.touch();
        await this.ctx.storage.setAlarm(Date.now() + this.ttlMs());
      }
      // Warm: the row's payload is ignored — the room is the live truth.
    } else {
      if (this.readMeta("code") === null) {
        return new Response("no such session", { status: 404 });
      }
      role =
        token && token === this.readMeta("editor_token")
          ? "editor"
          : token && token === this.readMeta("viewer_token")
            ? "viewer"
            : null;
      if (!role) return new Response("bad token", { status: 403 });
    }

    const counts = this.roleCounts();
    if (role === "editor" && counts.editors >= Number(this.env.MAX_EDITORS ?? DEFAULT_MAX_EDITORS)) {
      return new Response("room full", { status: 503 });
    }
    if (role === "viewer" && counts.viewers >= Number(this.env.MAX_VIEWERS ?? DEFAULT_MAX_VIEWERS)) {
      return new Response("room full", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const info: SocketInfo = {
      participantId: crypto.randomUUID(),
      nickname: "",
      role,
      ready: false,
    };
    server.serializeAttachment(info);
    this.touch();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 512 * 1024) {
      this.send(ws, { t: "error", code: "bad_message", message: "malformed message" });
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { t: "error", code: "bad_message", message: "malformed message" });
      return;
    }
    const info = ws.deserializeAttachment() as SocketInfo;
    this.touch();

    if (msg.t === "hello") {
      info.nickname = (msg.nickname ?? "").slice(0, MAX_NICKNAME_LEN).trim() || "anonymous";
      info.ready = true;
      ws.serializeAttachment(info);
      const name = this.readMeta("name");
      this.send(ws, {
        t: "welcome",
        participantId: info.participantId,
        role: info.role,
        kind: this.readMeta("kind") ?? "",
        ...(name !== null ? { name } : {}),
        doc: JSON.parse(this.readMeta("doc") ?? "null"),
        seq: Number(this.readMeta("seq") ?? "0"),
        participants: this.participants(),
      });
      this.broadcastPresence(ws);
      return;
    }

    if (msg.t === "nick") {
      if (!info.ready) return;
      info.nickname = (msg.nickname ?? "").slice(0, MAX_NICKNAME_LEN).trim() || "anonymous";
      ws.serializeAttachment(info);
      // Everyone INCLUDING the sender — their roster shows the rename took.
      this.broadcastPresence();
      return;
    }

    if (msg.t === "op") {
      if (!info.ready) return;
      if (info.role !== "editor") {
        // Viewers' writes are dropped with an explicit error, never applied.
        this.send(ws, { t: "error", code: "read_only", message: "viewers cannot edit" });
        return;
      }
      let nextDoc: unknown;
      try {
        nextDoc = applyDocOps(JSON.parse(this.readMeta("doc") ?? "null"), msg.ops);
      } catch (e) {
        // Reject atomically; the client hard-resyncs (reconnect → welcome).
        const message = e instanceof OpError ? e.message : "apply failed";
        this.send(ws, { t: "error", code: "bad_ops", message });
        return;
      }
      const text = JSON.stringify(nextDoc);
      if (new TextEncoder().encode(text).byteLength > this.maxPayloadBytes()) {
        // Rejected like bad_ops (the client resyncs to shed its over-cap
        // local change) — a doc-bound room must never outgrow what D1 takes.
        this.send(ws, { t: "error", code: "doc_too_large", message: "document exceeds the size cap" });
        return;
      }
      const seq = Number(this.readMeta("seq") ?? "0") + 1;
      this.writeMeta("doc", text);
      this.writeMeta("seq", String(seq));
      if (this.readMeta("doc_id") !== null) await this.schedulePersist();
      this.send(ws, { t: "ack", clientSeq: msg.clientSeq, seq });
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === ws) continue;
        const peerInfo = peer.deserializeAttachment() as SocketInfo | null;
        if (!peerInfo?.ready) continue;
        this.send(peer, { t: "op", seq, ops: msg.ops, from: info.participantId });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
    // Doc-bound: the last participant leaving flushes immediately — the
    // common "everyone closed the tab" path shouldn't wait out the debounce.
    if (this.readMeta("doc_id") !== null && this.socketsExcept(ws).length === 0) {
      try {
        await this.persistIfDirty();
      } catch {
        /* D1 hiccup — the armed alarm owns the retry */
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
  }

  /** One alarm, two duties: flush a due debounced persist (doc-bound), then
   *  idle-evict rooms past the TTL — re-arming for whichever comes first
   *  otherwise. Eviction of a dirty doc-bound room persists FIRST and re-arms
   *  on failure rather than dropping edits. */
  async alarm(): Promise<void> {
    if (
      this.readMeta("doc_id") !== null &&
      this.readMeta("dirty") === "1" &&
      Date.now() >= Number(this.readMeta("persist_due") ?? "0")
    ) {
      try {
        await this.persistIfDirty();
      } catch {
        // D1 unavailable — push the deadline out and retry on the cadence.
        this.writeMeta("persist_due", String(Date.now() + this.persistMs()));
      }
      if (this.readMeta("doc_id") === null && this.readMeta("code") === null) {
        return; // persist discovered the doc was deleted and shut us down
      }
    }

    const last = Number(this.readMeta("last_activity") ?? "0");
    if (Date.now() - last < this.ttlMs()) {
      await this.armAlarm();
      return;
    }

    if (this.readMeta("doc_id") !== null && this.readMeta("dirty") === "1") {
      try {
        await this.persistIfDirty();
      } catch {
        // Losing edits is worse than holding a slot: keep the room and retry.
        await this.ctx.storage.setAlarm(Date.now() + this.persistMs());
        return;
      }
      if (this.readMeta("doc_id") === null && this.readMeta("code") === null) return;
    }
    await this.shutdown("session expired");
  }

  /** The cloud doc backing this room was deleted — tear the room down. The
   *  worker calls this on every doc DELETE; a room that never went live is a
   *  cheap no-op. */
  async docDeleted(): Promise<void> {
    if (this.readMeta("doc_id") === null) return;
    await this.shutdown("doc deleted");
  }

  /** Deterministic flush for tests/ops — same path the alarm takes. */
  async persistNow(): Promise<void> {
    await this.persistIfDirty();
  }

  // ── doc-bound persistence ───────────────────────────────────────────────────

  /** Mark the doc dirty and make sure an alarm fires within the debounce
   *  window. An already-scheduled flush absorbs further edits (batching). */
  private async schedulePersist(): Promise<void> {
    this.writeMeta("dirty", "1");
    if (this.readMeta("persist_due") !== null) return;
    const due = Date.now() + this.persistMs();
    this.writeMeta("persist_due", String(due));
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > due) await this.ctx.storage.setAlarm(due);
  }

  /** Write the room's doc back to its D1 row. An UPDATE that touches no rows
   *  means the doc was deleted out from under the room — shut down instead of
   *  resurrecting it. Throws propagate to callers (they own retry policy). */
  private async persistIfDirty(): Promise<void> {
    const docId = this.readMeta("doc_id");
    if (docId === null || this.readMeta("dirty") !== "1") return;
    const result = await this.env.DB.prepare(
      "UPDATE documents SET payload = ?, updated_at = ? WHERE id = ?",
    )
      .bind(this.readMeta("doc"), Date.now(), docId)
      .run();
    if (result.meta.changes === 0) {
      await this.shutdown("doc deleted");
      return;
    }
    this.ctx.storage.sql.exec("DELETE FROM meta WHERE k IN ('dirty', 'persist_due')");
    // Long-lived active rooms re-stamp their slot so the sweep can't reap it.
    await this.registry().refresh(`doc:${docId}`);
  }

  /** Re-arm for whichever deadline comes first: a pending persist or idle
   *  eviction. The 1s floor prevents a hot loop if a deadline already passed. */
  private async armAlarm(): Promise<void> {
    const last = Number(this.readMeta("last_activity") ?? "0");
    let next = last + this.ttlMs();
    if (this.readMeta("dirty") === "1") {
      const due = this.readMeta("persist_due");
      if (due !== null) next = Math.min(next, Number(due));
    }
    await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1_000));
  }

  /** Close every socket, wipe storage, release the registry slot. The meta
   *  table is recreated empty (deleteAll drops it but this activation may
   *  still field calls) and any pending alarm cleared. */
  private async shutdown(reason: string): Promise<void> {
    const key = this.registryKey();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1001, reason);
      } catch {
        /* already gone */
      }
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    if (key) await this.registry().release(key);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private socketsExcept(except: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== except);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closing — presence will catch up */
    }
  }

  private participants(): Participant[] {
    const out: Participant[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment() as SocketInfo | null;
      if (info?.ready) {
        out.push({ id: info.participantId, nickname: info.nickname, role: info.role });
      }
    }
    return out;
  }

  private roleCounts(): { editors: number; viewers: number } {
    let editors = 0;
    let viewers = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment() as SocketInfo | null;
      if (info?.role === "editor") editors++;
      else if (info?.role === "viewer") viewers++;
    }
    return { editors, viewers };
  }

  /** Push the current roster to everyone except `except` (the socket whose
   *  own join/leave triggered the change gets its roster via welcome). */
  private broadcastPresence(except?: WebSocket): void {
    const participants = this.participants();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const info = ws.deserializeAttachment() as SocketInfo | null;
      if (!info?.ready) continue;
      this.send(ws, { t: "presence", participants });
    }
  }
}
