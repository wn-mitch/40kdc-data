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

export interface Env extends VerifyEntitlementEnv {
  DB: D1Database;
  MAX_DOCS_PER_OWNER?: string;
  MAX_LINKS_PER_OWNER?: string;
  MAX_PAYLOAD_BYTES?: string;
}

export const DOC_KINDS = ["list", "team-plan", "sb-save"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Same spoken-friendly alphabet as shadowboxing session codes (no 0/O/1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LINK_CODE_LEN = 8;
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

function newLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LINK_CODE_LEN));
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

/** Codes are case-insensitive; canonicalize so pasted lowercase still hits. */
function normalizeLinkCode(raw: string): string | null {
  const up = raw.trim().toUpperCase();
  if (up.length !== LINK_CODE_LEN) return null;
  for (const ch of up) if (!CODE_ALPHABET.includes(ch)) return null;
  return up;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM shortlinks WHERE owner = ?")
        .bind(owner)
        .first<{ n: number }>();
      if ((count?.n ?? 0) >= cap) return json({ error: "link_quota_exceeded" }, 403);

      for (let attempt = 0; attempt < LINK_MINT_ATTEMPTS; attempt++) {
        const code = newLinkCode();
        try {
          await env.DB.prepare(
            "INSERT INTO shortlinks (code, kind, payload, owner, created_at) VALUES (?, ?, ?, ?, ?)",
          )
            .bind(code, body.kind, text, owner, Date.now())
            .run();
          return json({ code });
        } catch {
          // PK collision (astronomically rare) — roll a fresh code.
        }
      }
      return json({ error: "mint_failed" }, 500);
    }

    // GET /docs?kind= → owner's documents, metadata only.
    if (request.method === "GET" && url.pathname === "/docs") {
      const kind = url.searchParams.get("kind");
      if (kind !== null && !isDocKind(kind)) return json({ error: "bad_kind" }, 400);
      const stmt = kind
        ? env.DB.prepare(
            "SELECT id, kind, name, length(payload) AS bytes, created_at, updated_at FROM documents WHERE owner = ? AND kind = ? ORDER BY updated_at DESC",
          ).bind(owner, kind)
        : env.DB.prepare(
            "SELECT id, kind, name, length(payload) AS bytes, created_at, updated_at FROM documents WHERE owner = ? ORDER BY updated_at DESC",
          ).bind(owner);
      const { results } = await stmt.all();
      return json({ docs: results });
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
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE owner = ?")
        .bind(owner)
        .first<{ n: number }>();
      if ((count?.n ?? 0) >= cap) return json({ error: "doc_quota_exceeded" }, 403);

      const id = crypto.randomUUID();
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO documents (id, owner, kind, name, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(id, owner, body.kind, name, text, now, now)
        .run();
      return json({ id, updated_at: now });
    }

    // /docs/:id → fetch / update / delete (owner-scoped: the WHERE clause
    // carries owner, so another patron's id 404s rather than leaks).
    const docMatch = url.pathname.match(/^\/docs\/([^/]+)$/);
    if (docMatch) {
      const id = decodeURIComponent(docMatch[1]);

      if (request.method === "GET") {
        const row = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND owner = ?")
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
          "SELECT name, updated_at FROM documents WHERE id = ? AND owner = ?",
        )
          .bind(id, owner)
          .first<{ name: string; updated_at: number }>();
        if (!row) return json({ error: "not_found" }, 404);

        // Optimistic-concurrency hint: a stale ifUpdatedAt means another
        // device wrote since this client last read — surface, don't clobber.
        if (typeof body.ifUpdatedAt === "number" && body.ifUpdatedAt !== row.updated_at) {
          return json({ error: "conflict", updated_at: row.updated_at, name: row.name }, 409);
        }

        const now = Date.now();
        await env.DB.prepare(
          "UPDATE documents SET name = ?, payload = ?, updated_at = ? WHERE id = ? AND owner = ?",
        )
          .bind(name ?? row.name, text, now, id, owner)
          .run();
        return json({ id, updated_at: now });
      }

      if (request.method === "DELETE") {
        const result = await env.DB.prepare("DELETE FROM documents WHERE id = ? AND owner = ?")
          .bind(id, owner)
          .run();
        return result.meta.changes > 0 ? json({ deleted: true }) : json({ error: "not_found" }, 404);
      }

      return json({ error: "method_not_allowed" }, 405);
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
