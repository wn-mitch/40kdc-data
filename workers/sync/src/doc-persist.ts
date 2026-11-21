/**
 * Doc-bound persistence for a DocRoom: bringing a cloud document live from
 * its D1 row, the debounced write-back, lease renewal, and reconciling with a
 * row that changed or vanished under the room. The fences themselves (lease
 * and version) are in doc-row.ts; DocRoom keeps connections and op handling.
 */
import { claimLease, clearLease, persistRow, renewLease, type LiveRow } from "./doc-row";
import type { SyncRegistry, SyncRegistryEnv } from "./sync-registry";

export interface DocRoomEnv extends SyncRegistryEnv {
  SYNC_REGISTRY: DurableObjectNamespace<SyncRegistry>;
  DB: D1Database;
  MAX_EDITORS?: string;
  MAX_VIEWERS?: string;
  MAX_PAYLOAD_BYTES?: string;
  DOC_PERSIST_SECONDS?: string;
}

const DEFAULT_TTL_MINUTES = 120;
/** Debounce window for writing a doc-bound room's edits back to D1. */
const DEFAULT_PERSIST_SECONDS = 15;
/** Distinct unconfirmed flush digests kept. Each is a doc state a flush may
 *  have committed; one flush per debounce during an outage stays far below. */
const MAX_UNCONFIRMED = 512;
/** Lease slack past the TTL — matches the registry's sweep slack. */
const LEASE_SLACK_MS = 30 * 60_000;

/** SHA-256 hex of a payload — identifies a flush without storing it twice. */
async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ttlMs(env: DocRoomEnv): number {
  return Number(env.DOC_SESSION_TTL_MINUTES ?? DEFAULT_TTL_MINUTES) * 60_000;
}

export function persistMs(env: DocRoomEnv): number {
  return Number(env.DOC_PERSIST_SECONDS ?? DEFAULT_PERSIST_SECONDS) * 1000;
}

export function registry(env: DocRoomEnv): DurableObjectStub<SyncRegistry> {
  return env.SYNC_REGISTRY.get(env.SYNC_REGISTRY.idFromName("global"));
}

/** The room's key/value `meta` table in Durable Object SQLite storage. */
export class RoomMeta {
  constructor(private readonly sql: SqlStorage) {}

  /** Create the table; idempotent, and re-run after storage.deleteAll(). */
  ensure(): void {
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  read(k: string): string | null {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return row ? row.v : null;
  }

  write(k: string, v: string): void {
    this.sql.exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      k,
      v,
    );
  }

  delete(...keys: string[]): void {
    for (const k of keys) this.sql.exec("DELETE FROM meta WHERE k = ?", k);
  }
}

/** What persistence needs from the room that owns it. */
export interface PersistHost {
  ctx: DurableObjectState;
  /** The room's env, read on every call so a rebound binding takes effect. */
  env(): DocRoomEnv;
  meta: RoomMeta;
  /** Send a fresh welcome to every participant that has said hello. */
  rewelcomeAll(): void;
  shutdown(reason: string): Promise<void>;
}

export class DocPersistence {
  /** Tail of the D1 row queue — see serial(). */
  private rowTail: Promise<void> = Promise.resolve();

  constructor(private readonly host: PersistHost) {}

  private get meta(): RoomMeta {
    return this.host.meta;
  }

  /** When a lease claimed or renewed now expires. */
  private leaseUntil(): number {
    return Date.now() + ttlMs(this.host.env()) + LEASE_SLACK_MS;
  }

  /** Win a registry slot, then claim the lease and load the doc in one
   *  statement: any snapshot PUT either landed before this read (and is
   *  loaded) or sees the lease. Returns the refusal, or null once live. */
  async bringLive(docId: string): Promise<{ status: number; body: string } | null> {
    const key = `doc:${docId}`;
    if (!(await registry(this.host.env()).tryAcquire(key))) return { status: 503, body: "at capacity" };
    let live: LiveRow | null;
    try {
      live = await claimLease(this.host.env().DB, docId, this.leaseUntil());
    } catch {
      // The claim may have committed with only its reply lost; drop it so no
      // lease outlives a room that never went live.
      await clearLease(this.host.env().DB, docId);
      await registry(this.host.env()).release(key);
      return { status: 503, body: "unavailable" };
    }
    if (!live) {
      await registry(this.host.env()).release(key);
      return { status: 404, body: "no such document" };
    }
    this.meta.write("doc_id", docId);
    this.meta.write("kind", live.kind);
    this.meta.write("name", live.name);
    this.meta.write("doc", live.payload);
    this.meta.write("version", String(live.updated_at));
    this.meta.write("seq", "0");
    this.meta.write("last_activity", String(Date.now()));
    await this.host.ctx.storage.setAlarm(Date.now() + ttlMs(this.host.env()));
    return null;
  }

  /** Mark the doc dirty and make sure an alarm fires within the debounce
   *  window. An already-scheduled flush absorbs further edits (batching). */
  async schedulePersist(): Promise<void> {
    this.meta.write("dirty", "1");
    if (this.meta.read("persist_due") !== null) return;
    const due = Date.now() + persistMs(this.host.env());
    this.meta.write("persist_due", String(due));
    const current = await this.host.ctx.storage.getAlarm();
    if (current === null || current > due) await this.host.ctx.storage.setAlarm(due);
  }

  /** Write the room's doc back to its D1 row, fenced on the room's version
   *  (doc-row.ts). A row that changed or vanished goes to reconcileRow rather
   *  than being overwritten or resurrected. Throws propagate to callers (they
   *  own retry policy).
   *  The D1 write is external I/O, so ops can land while it is in flight; the
   *  room stays dirty (with a fresh debounce) unless the seq it wrote is still
   *  current. updated_at strictly increases, matching the worker's PUT, so a
   *  client holding a pre-flush ifUpdatedAt always sees a conflict. */
  persistIfDirty(): Promise<void> {
    return this.serial(() => this.persistOnce());
  }

  /** Extend a doc-bound room's D1 lease (see doc-row.ts). Throws on a D1
   *  error; the alarm owns the retry. */
  renewDocLease(): Promise<void> {
    return this.serial(async () => {
      const docId = this.meta.read("doc_id");
      if (docId === null) return;
      if (this.knownVersion() === null) {
        // A room from before version tracking has no baseline to renew
        // against. Unsaved edits: write them, which starts tracking. Clean:
        // re-read the row through the lease claim (it adopts whatever is there).
        if (this.meta.read("dirty") === "1") await this.persistOnce();
        else await this.reconcileRow(docId);
        return;
      }
      const version = await renewLease(this.host.env().DB, docId, this.leaseUntil(), this.knownVersion());
      if (version === null) await this.reconcileRow(docId);
      else this.meta.write("version", String(version));
    });
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
    const docId = this.meta.read("doc_id");
    if (docId === null || this.meta.read("dirty") !== "1") return;
    const writtenSeq = this.meta.read("seq");
    const doc = this.meta.read("doc");
    // Record the attempt first: if D1 commits it but the reply is lost, the
    // retry fails the version fence, and reconcileRow must recognise the row
    // as this room's own write rather than an outside one.
    const attempt = await digest(doc ?? "");
    const wasUnconfirmed = this.unconfirmed().includes(attempt);
    this.noteUnconfirmed(attempt);
    const version = await persistRow(this.host.env().DB, docId, doc, this.leaseUntil(), this.knownVersion());
    if (version === null) {
      // A fence miss is a definite answer: this attempt wrote nothing.
      if (!wasUnconfirmed) this.dropUnconfirmed(attempt);
      await this.reconcileRow(docId);
      return;
    }
    this.meta.delete("unconfirmed");
    this.meta.write("version", String(version));
    this.meta.delete("persist_due");
    if (this.meta.read("seq") === writtenSeq) {
      this.meta.delete("dirty");
    } else {
      await this.schedulePersist();
    }
    // Long-lived active rooms re-stamp their slot so the sweep can't reap it.
    await registry(this.host.env()).refresh(`doc:${docId}`);
  }

  /** Digests of flushes sent since the last confirmed one (newest last). */
  private unconfirmed(): string[] {
    return JSON.parse(this.meta.read("unconfirmed") ?? "[]") as string[];
  }

  private noteUnconfirmed(d: string): void {
    const list = this.unconfirmed();
    if (list.includes(d)) return; // a retry of the same state adds nothing
    this.meta.write("unconfirmed", JSON.stringify([...list, d].slice(-MAX_UNCONFIRMED)));
  }

  private dropUnconfirmed(d: string): void {
    this.meta.write("unconfirmed", JSON.stringify(this.unconfirmed().filter((x) => x !== d)));
  }

  /** The D1 version this room last read or wrote (null: not yet tracked). */
  private knownVersion(): number | null {
    const v = this.meta.read("version");
    return v === null ? null : Number(v);
  }

  /** The row changed under the room (a snapshot PUT that landed while the
   *  lease had lapsed) or was deleted. Deleted: shut down. Changed: the PUT
   *  was acknowledged with a whole document, so the room adopts it, drops
   *  the edits it could not save, re-claims the lease, and re-welcomes every
   *  participant so their clients load the adopted document. */
  private async reconcileRow(docId: string): Promise<void> {
    // Hold ops while reloading: one acked during the claim would be applied
    // to the doc about to be replaced, and then dropped.
    const outcome = await this.host.ctx.blockConcurrencyWhile(async (): Promise<"deleted" | "own" | "adopted"> => {
      // Read through the lease claim: a PUT either precedes this read (and is
      // adopted) or sees the lease and is refused.
      const row = await claimLease(this.host.env().DB, docId, this.leaseUntil());
      if (!row) return "deleted";
      this.meta.write("version", String(row.updated_at));
      if (this.unconfirmed().includes(await digest(row.payload))) {
        // Our own write, committed with its reply lost. Keep the room's
        // (possibly newer) doc and dirty flag; the next flush writes it.
        this.meta.delete("unconfirmed");
        return "own";
      }
      this.meta.delete("unconfirmed");
      const changed =
        row.payload !== this.meta.read("doc") ||
        row.name !== this.meta.read("name") ||
        row.kind !== this.meta.read("kind");
      this.meta.delete("dirty", "persist_due");
      if (!changed) return "adopted";
      this.meta.write("kind", row.kind);
      this.meta.write("name", row.name);
      this.meta.write("doc", row.payload);
      this.meta.write("seq", String(Number(this.meta.read("seq") ?? "0") + 1));
      this.host.rewelcomeAll();
      return "adopted";
    });
    if (outcome === "deleted") {
      await this.host.shutdown("doc deleted");
    } else if (outcome === "own" && this.meta.read("dirty") === "1") {
      // Re-arm a fresh debounce for the doc the lost-reply flush left unsaved.
      this.meta.delete("persist_due");
      await this.schedulePersist();
    }
  }
}
