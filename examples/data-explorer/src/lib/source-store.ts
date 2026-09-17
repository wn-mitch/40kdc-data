/**
 * Source-text client for the roundtrip QA view.
 *
 * GW ability prose is never shipped in this repo or the npm package (IP safety).
 * It lives in the out-of-repo `40kdc-abilities` store, which is public on
 * GitHub. We fetch its flat `index.json` at runtime from a user-configurable
 * source (default `wn-mitch/40kdc-abilities@main`) over `raw.githubusercontent`
 * — which serves it with `access-control-allow-origin: *`, so a browser can read
 * it cross-origin with no auth. The deployed bundle therefore contains no GW
 * text; it only fetches a file the maintainer already publishes.
 */

export const DEFAULT_SOURCE = "wn-mitch/40kdc-abilities@main";

/**
 * One entry in the store's `index.json`, keyed by `ability_id`. Unit and
 * enhancement abilities carry a single `raw_text`; stratagem-shaped entries
 * carry the structured `when`/`target`/`effect`/`restrictions` fields instead.
 */
export interface StoreEntry {
  faction?: string;
  raw_text?: string;
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
}

export type StoreIndex = Record<string, StoreEntry>;

export interface ParsedSource {
  /** Human-readable label for status display. */
  label: string;
  /** Absolute URL of the store directory. */
  baseUrl: string;
}

/**
 * Resolve a user-supplied source spec to a concrete `index.json` URL. Accepts
 * `owner/repo`, `owner/repo@ref`, a raw base URL (`https://…/`), or a direct
 * `https://…/index.json` URL. Empty/blank falls back to {@link DEFAULT_SOURCE}.
 */
export function parseSource(spec: string): ParsedSource {
  const s = (spec ?? "").trim();
  if (!s) return parseSource(DEFAULT_SOURCE);

  if (/^https?:\/\//i.test(s)) {
    const baseUrl = /\.json($|\?)/i.test(s)
      ? s.replace(/\/[^/]*\.json(?:\?.*)?$/i, "")
      : s.replace(/\/+$/, "");
    return { label: s, baseUrl };
  }

  const m = s.match(/^([^/\s@]+)\/([^/\s@]+)(?:@(.+))?$/);
  if (!m) {
    throw new Error(
      `Invalid source "${spec}". Use owner/repo, owner/repo@ref, or a full URL.`,
    );
  }
  const owner = m[1];
  const repo = m[2];
  const ref = (m[3] ?? "main").trim() || "main";
  return {
    label: `${owner}/${repo}@${ref}`,
    baseUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}`,
  };
}

/** Which shape an entry takes — drives how the source panel renders it. */
export function entryKind(entry: StoreEntry | undefined): "raw" | "structured" | "empty" {
  if (!entry) return "empty";
  if (typeof entry.raw_text === "string" && entry.raw_text.trim() !== "") return "raw";
  if (entry.when || entry.target || entry.effect || entry.restrictions) return "structured";
  return "empty";
}

/** Render a store entry to a single plain-text block (used for display + export). */
export function entryToText(entry: StoreEntry | undefined): string {
  const kind = entryKind(entry);
  if (kind === "empty" || !entry) return "";
  if (kind === "raw") return entry.raw_text!.trim();
  const parts: string[] = [];
  if (entry.when) parts.push(`WHEN: ${entry.when}`);
  if (entry.target) parts.push(`TARGET: ${entry.target}`);
  if (entry.effect) parts.push(`EFFECT: ${entry.effect}`);
  if (entry.restrictions) parts.push(`RESTRICTIONS: ${entry.restrictions}`);
  return parts.join("\n");
}

const memCache = new Map<string, StoreIndex>();
const LS_PREFIX = "data-explorer:source-index:";
const LS_TTL_MS = 24 * 60 * 60 * 1000; // a day; the live CDN copy is the source of truth

function lsGet(url: string): StoreIndex | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(LS_PREFIX + url);
    if (!raw) return undefined;
    const { at, index } = JSON.parse(raw) as { at: number; index: StoreIndex };
    if (Date.now() - at > LS_TTL_MS) return undefined;
    return index;
  } catch {
    return undefined;
  }
}

function lsSet(url: string, index: StoreIndex): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS_PREFIX + url, JSON.stringify({ at: Date.now(), index }));
  } catch {
    // Over quota or disabled — non-fatal; memory cache still serves the session.
  }
}

export interface LoadResult {
  index: StoreIndex;
  label: string;
  count: number;
}


export async function loadFactionIndex(
  spec: string,
  factionId: string,
  opts: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<LoadResult> {
  const { baseUrl, label } = parseSource(spec);
  const cacheKey = `${baseUrl}#${factionId}`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!opts.force) {
    const cached = memCache.get(cacheKey) ?? lsGet(cacheKey);
    if (cached) return { index: cached, label, count: Object.keys(cached).length };
  }
  const load = async (url: string, expectedFaction: string): Promise<StoreIndex> => {
    const response = await fetchImpl(url);
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`Fetch failed (${response.status} ${response.statusText}) for ${url}`);
    const entries = await response.json() as unknown;
    if (!Array.isArray(entries)) throw new Error(`Unexpected index shape from ${url} (expected an array).`);
    const index: StoreIndex = {};
    for (const candidate of entries) {
      if (typeof candidate !== "object" || candidate === null) throw new Error(`Invalid ability entry in ${url}`);
      const entry = candidate as StoreEntry & { ability_id?: unknown; faction_id?: unknown };
      const textFields: (keyof StoreEntry)[] = ["raw_text", "when", "target", "effect", "restrictions"];
      if (
        typeof entry.ability_id !== "string" ||
        entry.ability_id.trim() === "" ||
        entry.faction_id !== expectedFaction ||
        textFields.some((field) => entry[field] !== undefined && typeof entry[field] !== "string") ||
        index[entry.ability_id]
      ) throw new Error(`Invalid ability entry in ${url}`);
      index[entry.ability_id] = { faction: entry.faction_id, raw_text: entry.raw_text, when: entry.when, target: entry.target, effect: entry.effect, restrictions: entry.restrictions };
    }
    return index;
  };
  const [core, faction] = await Promise.all([load(`${baseUrl}/core.json`, "core"), load(`${baseUrl}/${factionId}.json`, factionId)]);
  const index = { ...core, ...faction };
  memCache.set(cacheKey, index);
  lsSet(cacheKey, index);
  return { index, label, count: Object.keys(index).length };
}

/** Test-only: drop the in-memory cache. */
export function _clearMemCache(): void {
  memCache.clear();
}
