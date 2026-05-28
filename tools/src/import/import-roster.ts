/**
 * Orchestrates an army-list import: decode → parse → resolve.
 *
 * The adapter seam ({@link FormatAdapter}) lets every supported source format
 * plug in here without touching {@link decode} or {@link resolve}. Adapters are
 * registered in priority order — NewRecruit's tighter matchers run first so
 * the ListForge fallback only catches generic BattleScribe JSON.
 *
 * @packageDocumentation
 */
import { Dataset } from "../data/dataset.js";
import type { FormatAdapter } from "./adapter.js";
import { selectAdapter } from "./adapter.js";
import { decodeListForge } from "./decode.js";
import { listForgeAdapter } from "./listforge.js";
import { newRecruitJsonAdapter } from "./newrecruit-json.js";
import { newRecruitSimpleAdapter } from "./newrecruit-simple.js";
import {
  newRecruitWtcCompactAdapter,
  newRecruitWtcFullAdapter,
} from "./newrecruit-wtc.js";
import { resolve } from "./resolve.js";
import type { Roster } from "./types.js";

/**
 * Adapters available to {@link importRoster}, in match-priority order.
 *
 * NewRecruit-JSON runs ahead of ListForge because both recognise a
 * `roster.forces` BattleScribe payload, and the NewRecruit signature is more
 * specific (`xmlns: rosterSchema` or `generatedBy: newrecruit.eu`). The text
 * adapters (`wtc-compact` / `wtc-full` / `simple`) only match strings and
 * disambiguate among themselves via structural cues, so their order amongst
 * each other doesn't matter; wtc-full goes before wtc-compact because its
 * matcher is the more specific of the two.
 */
const ADAPTERS: readonly FormatAdapter[] = [
  newRecruitJsonAdapter,
  newRecruitWtcFullAdapter,
  newRecruitWtcCompactAdapter,
  newRecruitSimpleAdapter,
  listForgeAdapter,
];

export interface ImportOptions {
  /** Dataset to resolve against. Defaults to the package's embedded dataset. */
  dataset?: Dataset;
}

/**
 * Import a ListForge share payload into a resolved 40kdc {@link Roster}.
 *
 * `input` may be a full ListForge URL, a bare base64 segment, or an
 * already-decoded JSON string — all are handled transparently. For NewRecruit
 * sources, use {@link importNewRecruit} (no base64/gzip decode).
 */
export function importListForge(input: string, opts: ImportOptions = {}): Roster {
  const decoded = decodeListForge(input);
  return importRoster(decoded, opts);
}

/**
 * Import a NewRecruit export (any of the four formats — JSON, wtc-compact,
 * wtc-full, simple) into a resolved 40kdc {@link Roster}.
 *
 * The JSON form is parsed when `input` is valid JSON; the text forms are
 * dispatched on string content. No base64/gzip decoding is attempted —
 * NewRecruit exports are not encoded.
 */
export function importNewRecruit(input: string, opts: ImportOptions = {}): Roster {
  const trimmed = input.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return importRoster(JSON.parse(input), opts);
    } catch {
      // Fall through to treating the input as raw text.
    }
  }
  return importRoster(input, opts);
}

/**
 * Import an already-decoded payload. Selects the matching format adapter and
 * resolves the result against the dataset. Accepts either a parsed JSON object
 * (NewRecruit JSON / ListForge) or a string (the three NewRecruit text formats).
 */
/**
 * Detect an already-resolved canonical {@link Roster} (the JSON shape produced
 * by `rosterJsonSerializer`). Lets a downstream consumer round-trip canonical
 * Roster JSON through `importRoster` without going through an adapter.
 */
function isCanonicalRoster(decoded: unknown): decoded is Roster {
  if (typeof decoded !== "object" || decoded === null) return false;
  const r = decoded as Record<string, unknown>;
  const source = r.source as Record<string, unknown> | undefined;
  return (
    typeof source === "object" &&
    source !== null &&
    typeof source.format === "string" &&
    Array.isArray(r.units) &&
    "diagnostics" in r
  );
}

export function importRoster(decoded: unknown, opts: ImportOptions = {}): Roster {
  if (isCanonicalRoster(decoded)) return decoded;
  const ds = opts.dataset ?? Dataset.embedded();
  const adapter = selectAdapter(decoded, [...ADAPTERS]);
  const parsed = adapter.parse(decoded);
  return resolve(parsed, ds, adapter.id);
}
