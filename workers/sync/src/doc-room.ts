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
import { claimLease, clearLease, persistRow, renewLease, type LiveRow } from "./doc-row";
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
/** Distinct unconfirmed flush digests kept. Each is a doc state a flush may
 *  have committed; one flush per debounce during an outage stays far below. */
const MAX_UNCONFIRMED = 512;

/** SHA-256 hex of a payload — identifies a flush without storing it twice. */
async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lease slack past the TTL — matches the registry's sweep slack. */
const LEASE_SLACK_MS = 30 * 60_000;
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
  /** Tail of the D1 row queue — see serial(). */
  private rowTail: Promise<void> = Promise.resolve();
  /** The cold join bringing the room live, while it is in flight. */
  private coldJoin: Promise<{ status: number; body: string } | null> | null = null;

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

  /** When a lease claimed or renewed now expires. */
  private leaseUntil(): number {
    return Date.now() + this.ttlMs() + LEASE_SLACK_MS;
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
    if (docId !== null && this.readMeta("code") !== null) {
      // An ephemeral session room never becomes doc-bound. The worker strips
      // a client `doc` param on session routes; this is the room's own guard.
      return new Response("no such document", { status: 404 });
    }
    if (docId !== null) {
      // Doc-bound: tokens live on the D1 row. A cold join then loads the doc
      // through the lease claim below, not this read.
      const row = await this.env.DB.prepare(
        "SELECT editor_token, viewer_token FROM documents WHERE id = ?",
      )
        .bind(docId)
        .first<{
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
        // Concurrent cold joins share one bring-live, so a straggler can't
        // re-initialize a room that has already taken edits.
        this.coldJoin ??= this.bringLive(docId).finally(() => {
          this.coldJoin = null;
        });
        const refused = await this.coldJoin;
        if (refused) return new Response(refused.body, { status: refused.status });
        if (this.readMeta("doc_id") === null) {
          return new Response("no such document", { status: 404 }); // deleted meanwhile
        }
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

  /** Win a registry slot, then claim the lease and load the doc in one
   *  statement: any snapshot PUT either landed before this read (and is
   *  loaded) or sees the lease. Returns the refusal, or null once live. */
  private async bringLive(docId: string): Promise<{ status: number; body: string } | null> {
    const key = `doc:${docId}`;
    if (!(await this.registry().tryAcquire(key))) return { status: 503, body: "at capacity" };
    let live: LiveRow | null;
    try {
      live = await claimLease(this.env.DB, docId, this.leaseUntil());
    } catch {
      // The claim may have committed with only its reply lost; drop it so no
      // lease outlives a room that never went live.
      await clearLease(this.env.DB, docId);
      await this.registry().release(key);
      return { status: 503, body: "unavailable" };
    }
    if (!live) {
      await this.registry().release(key);
      return { status: 404, body: "no such document" };
    }
    this.writeMeta("doc_id", docId);
    this.writeMeta("kind", live.kind);
    this.writeMeta("name", live.name);
    this.writeMeta("doc", live.payload);
    this.writeMeta("version", String(live.updated_at));
    this.writeMeta("seq", "0");
    this.touch();
    await this.ctx.storage.setAlarm(Date.now() + this.ttlMs());
    return null;
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
      this.sendWelcome(ws, info, typeof msg.id === "number" ? msg.id : undefined);
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
      // Ack and broadcast before any await: another op could otherwise take
      // seq+1 and reach peers first, and clients apply ops in arrival order.
      this.send(ws, { t: "ack", clientSeq: msg.clientSeq, seq });
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === ws) continue;
        const peerInfo = peer.deserializeAttachment() as SocketInfo | null;
        if (!peerInfo?.ready) continue;
        this.send(peer, { t: "op", seq, ops: msg.ops, from: info.participantId });
      }
      if (this.readMeta("doc_id") !== null) await this.schedulePersist();
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
      // The registry sweeps slots by their stamp, not by liveness: re-stamp
      // on every active alarm (at most a TTL apart, inside the sweep horizon)
      // so a long-lived room — ephemeral, or doc-bound with no edits — keeps
      // its slot and its doc_live guard.
      const key = this.registryKey();
      if (key) await this.registry().refresh(key);
      try {
        await this.renewDocLease();
      } catch {
        // D1 unavailable: retry on the persist cadence, well inside the lease
        // slack, rather than a full TTL from now.
        await this.ctx.storage.setAlarm(Date.now() + this.persistMs());
        return;
      }
      if (this.readMeta("doc_id") === null && this.readMeta("code") === null) return;
      await this.armAlarm();
      return;
    }

    if (this.readMeta("doc_id") !== null && this.readMeta("dirty") === "1") {
      try {
        await this.persistIfDirty();
      } catch {
        // Losing edits is worse than holding a slot: keep the room and retry,
        // and keep its slot stamped so the sweep can't reap a room still alive.
        const key = this.registryKey();
        if (key) await this.registry().refresh(key);
        await this.ctx.storage.setAlarm(Date.now() + this.persistMs());
        return;
      }
      if (this.readMeta("doc_id") === null && this.readMeta("code") === null) return;
      if (this.readMeta("dirty") === "1") {
        // An edit landed during the D1 write — the room is active again.
        await this.armAlarm();
        return;
      }
    }
    await this.shutdown("session expired");
  }

  /** The cloud doc backing this room was deleted — tear the room down. The
   *  worker calls this on every doc DELETE; a room that never went live is a
   *  cheap no-op. */
  async docDeleted(): Promise<void> {
    // A delete can land while a cold join holds the claimed row but hasn't
    // published doc_id yet; let that join finish, then tear it down.
    if (this.coldJoin) await this.coldJoin.catch(() => null);
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

  /** Write the room's doc back to its D1 row, fenced on the room's version
   *  (doc-row.ts). A row that changed or vanished goes to reconcileRow rather
   *  than being overwritten or resurrected. Throws propagate to callers (they
   *  own retry policy).
   *  The D1 write is external I/O, so ops can land while it is in flight; the
   *  room stays dirty (with a fresh debounce) unless the seq it wrote is still
   *  current. updated_at strictly increases, matching the worker's PUT, so a
   *  client holding a pre-flush ifUpdatedAt always sees a conflict. */
  private persistIfDirty(): Promise<void> {
    return this.serial(() => this.persistOnce());
  }

  /** Run D1 row work one call at a time. Flushes (alarm, last socket closing,
   *  persistNow) and lease renewals all read and advance the room's version;
   *  interleaved, an older snapshot could land last, or a renewal could take
   *  the room's own write for an outside one. */
  private serial(fn: () => Promise<void>): Promise<void> {
    const run = this.rowTail.then(fn);
    this.rowTail = run.catch(() => {});
    return run;
  }

  private async persistOnce(): Promise<void> {
    const docId = this.readMeta("doc_id");
    if (docId === null || this.readMeta("dirty") !== "1") return;
    const writtenSeq = this.readMeta("seq");
    const doc = this.readMeta("doc");
    // Record the attempt first: if D1 commits it but the reply is lost, the
    // retry fails the version fence, and reconcileRow must recognise the row
    // as this room's own write rather than an outside one.
    const attempt = await digest(doc ?? "");
    const wasUnconfirmed = this.unconfirmed().includes(attempt);
    this.noteUnconfirmed(attempt);
    const version = await persistRow(this.env.DB, docId, doc, this.leaseUntil(), this.knownVersion());
    if (version === null) {
      // A fence miss is a definite answer: this attempt wrote nothing.
      if (!wasUnconfirmed) this.dropUnconfirmed(attempt);
      await this.reconcileRow(docId);
      return;
    }
    this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = 'unconfirmed'");
    this.writeMeta("version", String(version));
    this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = 'persist_due'");
    if (this.readMeta("seq") === writtenSeq) {
      this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = 'dirty'");
    } else {
      await this.schedulePersist();
    }
    // Long-lived active rooms re-stamp their slot so the sweep can't reap it.
    await this.registry().refresh(`doc:${docId}`);
  }

  /** Digests of flushes sent since the last confirmed one (newest last). */
  private unconfirmed(): string[] {
    return JSON.parse(this.readMeta("unconfirmed") ?? "[]") as string[];
  }

  private noteUnconfirmed(d: string): void {
    const list = this.unconfirmed();
    if (list.includes(d)) return; // a retry of the same state adds nothing
    this.writeMeta("unconfirmed", JSON.stringify([...list, d].slice(-MAX_UNCONFIRMED)));
  }

  private dropUnconfirmed(d: string): void {
    this.writeMeta("unconfirmed", JSON.stringify(this.unconfirmed().filter((x) => x !== d)));
  }

  /** The D1 version this room last read or wrote (null: not yet tracked). */
  private knownVersion(): number | null {
    const v = this.readMeta("version");
    return v === null ? null : Number(v);
  }

  /** Extend a doc-bound room's D1 lease (see doc-row.ts). Throws on a D1
   *  error; the alarm owns the retry. */
  private renewDocLease(): Promise<void> {
    return this.serial(async () => {
      const docId = this.readMeta("doc_id");
      if (docId === null) return;
      if (this.knownVersion() === null) {
        // A room from before version tracking has no baseline to renew
        // against. Unsaved edits: write them, which starts tracking. Clean:
        // re-read the row through the lease claim (it adopts whatever is there).
        if (this.readMeta("dirty") === "1") await this.persistOnce();
        else await this.reconcileRow(docId);
        return;
      }
      const version = await renewLease(this.env.DB, docId, this.leaseUntil(), this.knownVersion());
      if (version === null) await this.reconcileRow(docId);
      else this.writeMeta("version", String(version));
    });
  }

  /** The row changed under the room (a snapshot PUT that landed while the
   *  lease had lapsed) or was deleted. Deleted: shut down. Changed: the PUT
   *  was acknowledged with a whole document, so the room adopts it, drops
   *  the edits it could not save, re-claims the lease, and re-welcomes every
   *  participant so their clients load the adopted document. */
  private async reconcileRow(docId: string): Promise<void> {
    // Hold ops while reloading: one acked during the claim would be applied
    // to the doc about to be replaced, and then dropped.
    const outcome = await this.ctx.blockConcurrencyWhile(async (): Promise<"deleted" | "own" | "adopted"> => {
      // Read through the lease claim: a PUT either precedes this read (and is
      // adopted) or sees the lease and is refused.
      const row = await claimLease(this.env.DB, docId, this.leaseUntil());
      if (!row) return "deleted";
      this.writeMeta("version", String(row.updated_at));
      if (this.unconfirmed().includes(await digest(row.payload))) {
        // Our own write, committed with its reply lost. Keep the room's
        // (possibly newer) doc and dirty flag; the next flush writes it.
        this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = 'unconfirmed'");
        return "own";
      }
      this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = 'unconfirmed'");
      const changed =
        row.payload !== this.readMeta("doc") ||
        row.name !== this.readMeta("name") ||
        row.kind !== this.readMeta("kind");
      this.ctx.storage.sql.exec("DELETE FROM meta WHERE k IN ('dirty', 'persist_due')");
      if (!changed) return "adopted";
      this.writeMeta("kind", row.kind);
      this.writeMeta("name", row.name);
      this.writeMeta("doc", row.payload);
      this.writeMeta("seq", String(Number(this.readMeta("seq") ?? "0") + 1));
      for (const ws of this.ctx.getWebSockets()) {
        const info = ws.deserializeAttachment() as SocketInfo | null;
        if (info?.ready) this.sendWelcome(ws, info);
      }
      return "adopted";
    });
    if (outcome === "deleted") {
      await this.shutdown("doc deleted");
    } else if (outcome === "own" && this.readMeta("dirty") === "1") {
      // Re-arm a fresh debounce for the doc the lost-reply flush left unsaved.
      this.ctx.storage.sql.exec("DELETE FROM meta WHERE k = 'persist_due'");
      await this.schedulePersist();
    }
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
    // Hold every other event until teardown is done: a join that ran during
    // the awaits below would bring a fresh room live, and this shutdown would
    // then release its registry slot and clear its lease.
    await this.ctx.blockConcurrencyWhile(async () => {
      const key = this.registryKey();
      const docId = this.readMeta("doc_id");
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
      if (docId !== null) await clearLease(this.env.DB, docId);
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private sendWelcome(ws: WebSocket, info: SocketInfo, helloId?: number): void {
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
      ...(helloId !== undefined ? { helloId } : {}),
    });
  }

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
