/**
 * Turns an uploaded list into a roster: a BattleScribe `.ros`/`.rosz`, a 40kdc
 * share token or share link, or anything the package's importers read
 * (NewRecruit, ListForge, GW app, WTC, Rosterizer and 40kdc roster JSON or text).
 *
 * The package is imported by source module rather than through its barrel, which
 * also loads the Node-only schema validator.
 */
import { Dataset } from "../../../tools/src/data/dataset.js";
import { importBattleScribe, isZip } from "../../../tools/src/import/battlescribe-ros.js";
import { tryImportRoster, type ImportResult } from "../../../tools/src/import/import-roster.js";
import { decodeShareToken, shareListToRoster } from "../../../tools/src/share/index.js";

let dataset: Dataset | undefined;

/** The embedded matched-play dataset, parsed on first use. */
export function embeddedDataset(): Dataset {
  return (dataset ??= Dataset.embedded());
}

/** A list-builder share link (`…#l=<token>`) or a bare token. */
const SHARE_LINK = /[#&?]l=([A-Za-z0-9_-]+)/;
const BARE_TOKEN = /^[A-Za-z0-9_-]{8,}$/;

function fromShareToken(token: string, ds: Dataset): ImportResult | null {
  const decoded = decodeShareToken(token);
  if (decoded.ok) return { ok: true, roster: shareListToRoster(decoded.list, ds), format: "roster-json" };
  if (decoded.reason === "stale-registry") {
    return { ok: false, reason: "decode-failed", message: "share token names records this server does not know; it was made with a newer dataset", trials: [] };
  }
  return null;
}

/** The roster an upload holds. `filename` (when the client sends one) only routes BattleScribe files. */
export function rosterFromUpload(bytes: Uint8Array, filename: string | null, ds: Dataset = embeddedDataset()): ImportResult {
  const lower = filename?.toLowerCase() ?? "";
  if (isZip(bytes) || lower.endsWith(".rosz") || lower.endsWith(".ros")) return importBattleScribe(bytes, { dataset: ds });
  const text = new TextDecoder().decode(bytes).trim();
  if (text.startsWith("<")) return importBattleScribe(text, { dataset: ds });
  const link = text.match(SHARE_LINK);
  if (link || BARE_TOKEN.test(text)) {
    const shared = fromShareToken(link ? link[1]! : text, ds);
    if (shared) return shared;
  }
  return tryImportRoster(text, { dataset: ds });
}
