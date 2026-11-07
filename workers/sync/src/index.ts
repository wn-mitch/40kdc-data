/**
 * 40kdc-sync — cloud documents + shortlinks for the alpacasoft app family
 * (list-builder, teams-planner, shadowboxing saves), at sync.alpacasoft.dev.
 *
 * Patron-gated CREATION, free OPENING: every write requires an entitlement
 * token from keys.alpacasoft.dev (verified with a pinned Ed25519 public key —
 * this worker holds no secrets); resolving a shortlink is anonymous. Documents
 * are small JSON snapshots in D1, keyed by the token's `sub` (a Patreon user
 * id, or `key:<label>` — holders of one access key share a namespace).
 *
 * Live shared-session rooms (DocRoom) land separately; this module is the
 * at-rest half.
 */
import { authenticate, type VerifyEntitlementEnv } from "./verify-entitlement";
import { DocRoom, type DocRoomEnv } from "./doc-room";
import { SyncRegistry } from "./sync-registry";

// The DO classes must be exported from the Worker's main module.
export { DocRoom, SyncRegistry };

export interface Env extends VerifyEntitlementEnv, DocRoomEnv {
  DOC_ROOM: DurableObjectNamespace<DocRoom>;
  MAX_DOCS_PER_OWNER?: string;
  MAX_LINKS_PER_OWNER?: string;
}

export const DOC_KINDS = ["list", "team-plan", "sb-save", "mission-matrix", "threat-matrix"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Same spoken-friendly alphabet as shadowboxing session codes (no 0/O/1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LINK_CODE_LEN = 8;
/** Live-session codes: 6 chars, spoken aloud on a call — same as shadowboxing. */
const SESSION_CODE_LEN = 6;
/** Code-collision retries at session create (31^6 codes; ~never needed). */
const SESSION_MINT_ATTEMPTS = 3;
/** PK-collision retries when minting a code (collisions are ~never at 31^8). */
const LINK_MINT_ATTEMPTS = 5;

const MAX_NAME_LEN = 200;
const DEFAULT_MAX_DOCS = 100;
const DEFAULT_MAX_LINKS = 200;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** Parse a JSON body, tolerating garbage from hostile clients. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function newCode(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

function newLinkCode(): string {
  return newCode(LINK_CODE_LEN);
}

/** Codes are case-insensitive; canonicalize so pasted lowercase still hits. */
function normalizeCode(raw: string, len: number): string | null {
  const up = raw.trim().toUpperCase();
  if (up.length !== len) return null;
  for (const ch of up) if (!CODE_ALPHABET.includes(ch)) return null;
  return up;
}

function normalizeLinkCode(raw: string): string | null {
  return normalizeCode(raw, LINK_CODE_LEN);
}

function isDocKind(v: unknown): v is DocKind {
  return typeof v === "string" && (DOC_KINDS as readonly string[]).includes(v);
}

/** Validate + canonicalize an inbound payload. Returns the JSON text to store,
 *  or null if it is missing/oversized. Any JSON value is allowed — apps own
 *  their schemas; the worker owns only the size cap. */
function payloadText(payload: unknown, env: Env): string | null {
  if (payload === undefined) return null;
  const text = JSON.stringify(payload);
  if (typeof text !== "string") return null;
  const cap = Number(env.MAX_PAYLOAD_BYTES ?? DEFAULT_MAX_PAYLOAD_BYTES);
  return new TextEncoder().encode(text).byteLength <= cap ? text : null;
}

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name && name.length <= MAX_NAME_LEN ? name : null;
}

type DocRow = {
  id: string;
  owner: string;
  kind: string;
  name: string;
  payload: string;
  created_at: number;
  updated_at: number;
};

/** Which share role (if any) a presented link token grants on a doc. */
function shareRole(
  row: { editor_token: string | null; viewer_token: string | null },
  token: string,
): "editor" | "viewer" | null {
  if (!token) return null;
  if (row.editor_token && token === row.editor_token) return "editor";
  if (row.viewer_token && token === row.viewer_token) return "viewer";
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }

    // ── Shortlinks: resolving is free (this is the whole point of a link) ────
    const linkMatch = url.pathname.match(/^\/links\/([^/]+)$/);
    if (request.method === "GET" && linkMatch) {
      const code = normalizeLinkCode(decodeURIComponent(linkMatch[1]));
      if (!code) return json({ error: "bad_code" }, 400);
      const row = await env.DB.prepare(
        "SELECT kind, payload, created_at FROM shortlinks WHERE code = ?",
      )
        .bind(code)
        .first<{ kind: string; payload: string; created_at: number }>();
      if (!row) return json({ error: "not_found" }, 404);
      // Fire-and-forget popularity counter; never blocks the resolve.
      void env.DB.prepare("UPDATE shortlinks SET hits = hits + 1 WHERE code = ?").bind(code).run();
      return json({ kind: row.kind, payload: JSON.parse(row.payload), created_at: row.created_at });
    }

    // GET /docs/:id/shared?token= → anonymous at-rest read for share-link
    // holders (either role token). This is the read-only fallback when the
    // live room is full, and the non-WebSocket path for view links.
    const sharedMatch = url.pathname.match(/^\/docs\/([^/]+)\/shared$/);
    if (request.method === "GET" && sharedMatch) {
      const id = decodeURIComponent(sharedMatch[1]);
      const row = await env.DB.prepare(
        "SELECT kind, name, payload, updated_at, editor_token, viewer_token FROM documents WHERE id = ?",
      )
        .bind(id)
        .first<{
          kind: string;
          name: string;
          payload: string;
          updated_at: number;
          editor_token: string | null;
          viewer_token: string | null;
        }>();
      if (!row) return json({ error: "not_found" }, 404);
      const role = shareRole(row, url.searchParams.get("token") ?? "");
      if (!role) return json({ error: "bad_token" }, 403);
      return json({
        kind: row.kind,
        name: row.name,
        payload: JSON.parse(row.payload),
        updated_at: row.updated_at,
        role,
      });
    }

    // GET /session/:code/ws → WebSocket upgrade. No entitlement check — the
    // role-scoped link token IS the auth (joining is free; creation is gated).
    const wsMatch = url.pathname.match(/^\/session\/([^/]+)\/ws$/);
    if (request.method === "GET" && wsMatch) {
      const code = normalizeCode(decodeURIComponent(wsMatch[1]), SESSION_CODE_LEN);
      if (!code) return json({ error: "bad_code" }, 400);
      // `doc` switches a room into doc-bound mode and is only ever server-set
      // (below) — strip a client-supplied one so a session code can't be
      // pointed at someone else's document.
      const fwd = new URL(request.url);
      fwd.searchParams.delete("doc");
      // getByName → the same code always reaches the same room instance.
      return env.DOC_ROOM.get(env.DOC_ROOM.idFromName(code)).fetch(new Request(fwd, request));
    }

    // GET /docs/:id/ws → live editing of a cloud doc (doc-bound room). Free
    // to join like sessions — the durable share token is the auth; the room
    // itself validates it against the D1 row. The `doc` param is server-set
    // here so a client can never point the room at a different row.
    const docWsMatch = url.pathname.match(/^\/docs\/([^/]+)\/ws$/);
    if (request.method === "GET" && docWsMatch) {
      const id = decodeURIComponent(docWsMatch[1]);
      const fwd = new URL(request.url);
      fwd.searchParams.set("doc", id);
      return env.DOC_ROOM.get(env.DOC_ROOM.idFromName(`doc:${id}`)).fetch(new Request(fwd, request));
    }

    // ── Everything below requires an owner identity ──────────────────────────
    const auth = await authenticate(request, env);
    if (!auth.ok) {
      return json({ error: auth.status === 501 ? "gate_not_configured" : "not_entitled" }, auth.status);
    }
    const owner = auth.owner;

    // POST /links → mint a shortlink (patron-gated).
    if (request.method === "POST" && url.pathname === "/links") {
      const body = await readJson(request);
      if (!isDocKind(body.kind)) return json({ error: "bad_kind" }, 400);
      const text = payloadText(body.payload, env);
      if (text === null) return json({ error: "bad_payload" }, 400);

      const cap = Number(env.MAX_LINKS_PER_OWNER ?? DEFAULT_MAX_LINKS);
      for (let attempt = 0; attempt < LINK_MINT_ATTEMPTS; attempt++) {
        const code = newLinkCode();
        try {
          // The quota check rides in the INSERT itself: one statement, so
          // concurrent mints can't all pass a count taken before any insert.
          const inserted = await env.DB.prepare(
            "INSERT INTO shortlinks (code, kind, payload, owner, created_at) " +
              "SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM shortlinks WHERE owner = ?) < ?",
          )
            .bind(code, body.kind, text, owner, Date.now(), owner, cap)
            .run();
          if (inserted.meta.changes === 0) return json({ error: "link_quota_exceeded" }, 403);
          return json({ code });
        } catch {
          // PK collision (astronomically rare) — roll a fresh code.
        }
      }
      return json({ error: "mint_failed" }, 500);
    }

    // POST /session → create a live editing room seeded with the creator's
    // current document. Gated twice: entitlement (who may create) and the
    // registry concurrency cap (the hard spend ceiling).
    if (request.method === "POST" && url.pathname === "/session") {
      const body = await readJson(request);
      if (!isDocKind(body.kind)) return json({ error: "bad_kind" }, 400);
      const text = payloadText(body.payload, env);
      if (text === null) return json({ error: "bad_payload" }, 400);

      const registry = env.SYNC_REGISTRY.get(env.SYNC_REGISTRY.idFromName("global"));
      for (let attempt = 0; attempt < SESSION_MINT_ATTEMPTS; attempt++) {
        const code = newCode(SESSION_CODE_LEN);
        if (!(await registry.tryAcquire(code))) {
          return json({ error: "at_capacity" }, 503);
        }
        const tokens = await env.DOC_ROOM.get(env.DOC_ROOM.idFromName(code)).init(code, body.kind, JSON.parse(text));
        if (tokens) {
          return json({ code, editorToken: tokens.editorToken, viewerToken: tokens.viewerToken });
        }
        // Code collided with a live room. The registry row is that room's own
        // slot (tryAcquire upserts by code), so it stays; just reroll.
      }
      return json({ error: "mint_failed" }, 500);
    }

    // GET /docs?kind= → owner's documents, metadata only.
    if (request.method === "GET" && url.pathname === "/docs") {
      const kind = url.searchParams.get("kind");
      if (kind !== null && !isDocKind(kind)) return json({ error: "bad_kind" }, 400);
      const cols =
        "id, kind, name, length(payload) AS bytes, created_at, updated_at, editor_token IS NOT NULL AS shared";
      const stmt = kind
        ? env.DB.prepare(
            `SELECT ${cols} FROM documents WHERE owner = ? AND kind = ? ORDER BY updated_at DESC`,
          ).bind(owner, kind)
        : env.DB.prepare(
            `SELECT ${cols} FROM documents WHERE owner = ? ORDER BY updated_at DESC`,
          ).bind(owner);
      const { results } = await stmt.all();
      // D1 returns the IS NOT NULL expression as 0/1 — make it a real boolean.
      return json({ docs: results.map((d) => ({ ...d, shared: Boolean(d.shared) })) });
    }

    // POST /docs → create.
    if (request.method === "POST" && url.pathname === "/docs") {
      const body = await readJson(request);
      if (!isDocKind(body.kind)) return json({ error: "bad_kind" }, 400);
      const name = cleanName(body.name);
      if (!name) return json({ error: "bad_name" }, 400);
      const text = payloadText(body.payload, env);
      if (text === null) return json({ error: "bad_payload" }, 400);

      const cap = Number(env.MAX_DOCS_PER_OWNER ?? DEFAULT_MAX_DOCS);
      const id = crypto.randomUUID();
      const now = Date.now();
      // Quota check inside the INSERT (one atomic statement) — see /links.
      const inserted = await env.DB.prepare(
        "INSERT INTO documents (id, owner, kind, name, payload, created_at, updated_at) " +
          "SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM documents WHERE owner = ?) < ?",
      )
        .bind(id, owner, body.kind, name, text, now, now, owner, cap)
        .run();
      if (inserted.meta.changes === 0) return json({ error: "doc_quota_exceeded" }, 403);
      return json({ id, updated_at: now });
    }

    // POST /docs/:id/share → mint (or rotate) the durable share tokens that
    // make a doc's live link work. Idempotent: re-sharing returns the same
    // tokens; {regenerate: true} rotates both so old links stop admitting
    // new joins.
    const shareMatch = url.pathname.match(/^\/docs\/([^/]+)\/share$/);
    if (request.method === "POST" && shareMatch) {
      const id = decodeURIComponent(shareMatch[1]);
      const body = await readJson(request);
      // One statement either way, returning the tokens the row ends up with.
      // Without regenerate, COALESCE keeps tokens that already exist, so two
      // concurrent first shares agree on one pair instead of the second
      // silently invalidating the links the first handed out.
      const sql =
        body.regenerate === true
          ? "UPDATE documents SET editor_token = ?, viewer_token = ? WHERE id = ? AND owner = ? RETURNING editor_token, viewer_token"
          : "UPDATE documents SET editor_token = COALESCE(editor_token, ?), viewer_token = COALESCE(viewer_token, ?) WHERE id = ? AND owner = ? RETURNING editor_token, viewer_token";
      const row = await env.DB.prepare(sql)
        .bind(crypto.randomUUID(), crypto.randomUUID(), id, owner)
        .first<{ editor_token: string; viewer_token: string }>();
      if (!row) return json({ error: "not_found" }, 404);
      return json({ id, editorToken: row.editor_token, viewerToken: row.viewer_token });
    }

    // /docs/:id → fetch / update / delete (owner-scoped: the WHERE clause
    // carries owner, so another patron's id 404s rather than leaks).
    const docMatch = url.pathname.match(/^\/docs\/([^/]+)$/);
    if (docMatch) {
      const id = decodeURIComponent(docMatch[1]);

      if (request.method === "GET") {
        // Explicit columns: the share tokens must never ride along on a read.
        const row = await env.DB.prepare(
          "SELECT id, owner, kind, name, payload, created_at, updated_at FROM documents WHERE id = ? AND owner = ?",
        )
          .bind(id, owner)
          .first<DocRow>();
        if (!row) return json({ error: "not_found" }, 404);
        return json({ ...row, payload: JSON.parse(row.payload) });
      }

      if (request.method === "PUT") {
        const body = await readJson(request);
        const text = payloadText(body.payload, env);
        if (text === null) return json({ error: "bad_payload" }, 400);
        const name = body.name === undefined ? undefined : cleanName(body.name);
        if (name === null) return json({ error: "bad_name" }, 400);

        const row = await env.DB.prepare(
          "SELECT name, updated_at, live_until FROM documents WHERE id = ? AND owner = ?",
        )
          .bind(id, owner)
          .first<{ name: string; updated_at: number; live_until: number | null }>();
        if (!row) return json({ error: "not_found" }, 404);

        // While a live room holds this doc, the room is the source of truth —
        // a snapshot PUT would be clobbered by its next persist. Refuse
        // honestly and steer the client to the live session instead. The
        // room's D1 lease (migration 0005) is checked inside the UPDATE, so a
        // room going live mid-request can't slip between check and write.
        if (row.live_until !== null && row.live_until >= Date.now()) {
          return json({ error: "doc_live" }, 409);
        }
        // The registry slot also marks a live room, including rooms that went
        // live before leases existed and have not renewed one yet.
        const registry = env.SYNC_REGISTRY.get(env.SYNC_REGISTRY.idFromName("global"));
        if (await registry.has(`doc:${id}`)) {
          return json({ error: "doc_live" }, 409);
        }
        // Optimistic concurrency: a stale ifUpdatedAt means another device
        // wrote since this client last read — surface, don't clobber. The
        // version check is repeated in the UPDATE's WHERE so a write landing
        // between the read above and this statement still fails it. Without
        // ifUpdatedAt the write is last-write-wins. updated_at strictly
        // increases (never repeats a millisecond), so it stays a usable version.
        const ifUpdatedAt = typeof body.ifUpdatedAt === "number" ? body.ifUpdatedAt : null;
        if (ifUpdatedAt !== null && ifUpdatedAt !== row.updated_at) {
          return json({ error: "conflict", updated_at: row.updated_at, name: row.name }, 409);
        }
        const now = Date.now();
        const updated = await env.DB.prepare(
          "UPDATE documents SET name = COALESCE(?, name), payload = ?, updated_at = MAX(?, updated_at + 1) " +
            "WHERE id = ? AND owner = ? AND (? IS NULL OR updated_at = ?) " +
            "AND (live_until IS NULL OR live_until < ?) RETURNING updated_at",
        )
          .bind(name ?? null, text, now, id, owner, ifUpdatedAt, ifUpdatedAt, now)
          .first<{ updated_at: number }>();
        if (updated) return json({ id, updated_at: updated.updated_at });
        const current = await env.DB.prepare(
          "SELECT name, updated_at, live_until FROM documents WHERE id = ? AND owner = ?",
        )
          .bind(id, owner)
          .first<{ name: string; updated_at: number; live_until: number | null }>();
        if (!current) return json({ error: "not_found" }, 404);
        if (current.live_until !== null && current.live_until >= now) {
          return json({ error: "doc_live" }, 409);
        }
        return json({ error: "conflict", updated_at: current.updated_at, name: current.name }, 409);
      }

      if (request.method === "DELETE") {
        const result = await env.DB.prepare("DELETE FROM documents WHERE id = ? AND owner = ?")
          .bind(id, owner)
          .run();
        if (result.meta.changes === 0) return json({ error: "not_found" }, 404);
        // Delete always wins over a live room: tear it down (no-op when cold).
        ctx.waitUntil(env.DOC_ROOM.get(env.DOC_ROOM.idFromName(`doc:${id}`)).docDeleted());
        return json({ deleted: true });
      }

      return json({ error: "method_not_allowed" }, 405);
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
