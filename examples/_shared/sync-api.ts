/**
 * Typed client for the 40kdc sync worker (sync.alpacasoft.dev): cloud
 * documents + shortlinks. All write routes take the entitlement bearer; link
 * resolution is anonymous. Expected failures come back as discriminated
 * results, not throws — only network-level faults reject.
 */

export const SYNC_URL: string =
  (import.meta.env as Record<string, string | undefined>).VITE_SYNC_URL ??
  "https://sync.alpacasoft.dev";

export type DocKind = "list" | "team-plan" | "sb-save";

export interface DocMeta {
  id: string;
  kind: DocKind;
  name: string;
  bytes: number;
  created_at: number;
  updated_at: number;
  /** Durable share tokens exist (the doc has a live link). */
  shared: boolean;
}

export interface DocFull extends Omit<DocMeta, "bytes"> {
  payload: unknown;
}

export type SyncResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

/** PUT outcome: ok, a 409 conflict (with the cloud side's current state for
 *  the prompt), or a plain error. */
export type PutResult =
  | { ok: true; updated_at: number }
  | { ok: false; conflict: { updated_at: number; name: string } }
  | { ok: false; error: string; status: number };

async function call(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${SYNC_URL.replace(/\/$/, "")}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function asResult<T>(res: { status: number; body: any }, pick: (body: any) => T): SyncResult<T> {
  if (res.status >= 200 && res.status < 300) return { ok: true, value: pick(res.body) };
  return { ok: false, error: res.body?.error ?? `http_${res.status}`, status: res.status };
}

export async function listDocs(token: string, kind?: DocKind): Promise<SyncResult<DocMeta[]>> {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  return asResult(await call(`/docs${q}`, { token }), (b) => b.docs as DocMeta[]);
}

export async function createDoc(
  token: string,
  doc: { kind: DocKind; name: string; payload: unknown },
): Promise<SyncResult<{ id: string; updated_at: number }>> {
  return asResult(await call("/docs", { method: "POST", token, body: doc }), (b) => b);
}

export async function getDoc(token: string, id: string): Promise<SyncResult<DocFull>> {
  const res = await call(`/docs/${encodeURIComponent(id)}`, { token });
  return asResult(res, (b) => b as DocFull);
}

export async function putDoc(
  token: string,
  id: string,
  body: { name?: string; payload: unknown; ifUpdatedAt?: number },
): Promise<PutResult> {
  const res = await call(`/docs/${encodeURIComponent(id)}`, { method: "PUT", token, body });
  // 409 covers two distinct refusals: a stale ifUpdatedAt (cross-device
  // conflict, prompt-worthy) and doc_live (a live room owns the doc).
  if (res.status === 409 && res.body?.error === "conflict") {
    return { ok: false, conflict: { updated_at: res.body.updated_at, name: res.body.name } };
  }
  if (res.status >= 200 && res.status < 300) return { ok: true, updated_at: res.body.updated_at };
  return { ok: false, error: res.body?.error ?? `http_${res.status}`, status: res.status };
}

export async function deleteDoc(token: string, id: string): Promise<SyncResult<true>> {
  return asResult(await call(`/docs/${encodeURIComponent(id)}`, { method: "DELETE", token }), () => true);
}

/** Mint (or with `regenerate`, rotate) a doc's durable share tokens. */
export async function shareDoc(
  token: string,
  id: string,
  regenerate = false,
): Promise<SyncResult<{ editorToken: string; viewerToken: string }>> {
  return asResult(
    await call(`/docs/${encodeURIComponent(id)}/share`, {
      method: "POST",
      token,
      ...(regenerate ? { body: { regenerate: true } } : {}),
    }),
    (b) => ({ editorToken: b.editorToken as string, viewerToken: b.viewerToken as string }),
  );
}

/** Anonymous at-rest read for share-link holders — the read-only fallback
 *  when the live room is full, and the non-WebSocket path for view links. */
export async function getSharedDoc(
  id: string,
  linkToken: string,
): Promise<
  SyncResult<{ kind: DocKind; name: string; payload: unknown; updated_at: number; role: "editor" | "viewer" }>
> {
  return asResult(
    await call(
      `/docs/${encodeURIComponent(id)}/shared?token=${encodeURIComponent(linkToken)}`,
    ),
    (b) => b,
  );
}

export async function mintLink(
  token: string,
  kind: DocKind,
  payload: unknown,
): Promise<SyncResult<string>> {
  return asResult(
    await call("/links", { method: "POST", token, body: { kind, payload } }),
    (b) => b.code as string,
  );
}

export async function resolveLink(
  code: string,
): Promise<SyncResult<{ kind: DocKind; payload: unknown }>> {
  return asResult(await call(`/links/${encodeURIComponent(code)}`), (b) => b);
}

// ── Pure shortlink-URL helpers (unit-tested) ─────────────────────────────────

const LINK_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/i;

/** The `?s=CODE` shortlink URL for the current app origin. */
export function shortlinkUrl(origin: string, pathname: string, code: string): string {
  return `${origin}${pathname}?s=${code}`;
}

/**
 * Extract a shortlink code from pasted text or the current location: accepts
 * a bare code, or any URL (any origin) carrying `?s=CODE` — which is exactly
 * what lets a list-builder link paste straight into shadowboxing.
 */
export function parseShortlink(input: string): string | null {
  const text = input.trim();
  if (LINK_CODE_RE.test(text)) return text.toUpperCase();
  try {
    const url = new URL(text);
    const code = url.searchParams.get("s") ?? "";
    return LINK_CODE_RE.test(code) ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

// ── Live doc-link helpers (pure, unit-tested) ────────────────────────────────

/** The durable live link for a shared cloud doc: `?d=<docId>&token=<token>`.
 *  Opening it joins live editing/viewing of THAT doc; the params stay in the
 *  URL so a refresh rejoins. */
export function docInviteUrl(
  origin: string,
  pathname: string,
  docId: string,
  token: string,
): string {
  return `${origin}${pathname}?d=${encodeURIComponent(docId)}&token=${encodeURIComponent(token)}`;
}

/** Parse a live doc link's query (`?d=<docId>&token=<token>`). */
export function parseDocInvite(search: string): { docId: string; token: string } | null {
  const params = new URLSearchParams(search);
  const docId = params.get("d") ?? "";
  const token = params.get("token") ?? "";
  return docId && token ? { docId, token } : null;
}
