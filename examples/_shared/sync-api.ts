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
  if (res.status === 409) {
    return { ok: false, conflict: { updated_at: res.body.updated_at, name: res.body.name } };
  }
  if (res.status >= 200 && res.status < 300) return { ok: true, updated_at: res.body.updated_at };
  return { ok: false, error: res.body?.error ?? `http_${res.status}`, status: res.status };
}

export async function deleteDoc(token: string, id: string): Promise<SyncResult<true>> {
  return asResult(await call(`/docs/${encodeURIComponent(id)}`, { method: "DELETE", token }), () => true);
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
