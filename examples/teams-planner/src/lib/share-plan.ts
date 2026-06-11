/**
 * Backend-free plan sharing: a team plan JSON-encoded, gzipped, and base64url'd
 * into a `#t=<token>` URL fragment — the same `base64(gzip(...))` shape the
 * list-builder uses for `#list=` links. Opening the link decodes it client-side
 * with no server. Browser-only (btoa/atob); fflate is already a dependency.
 *
 * Decoding is defensive: malformed input yields `null`, and faction/detachment
 * ids the current dataset no longer knows are dropped (and reported), so an old
 * link made against a newer dataset still opens with whatever remains valid.
 */
import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";
import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
import type { IntentTier, Player, TeamPlan } from "./coverage";
import { detachmentsForFactions, isKnownFaction, playerCoverage } from "./coverage";
import { DISPOSITIONS } from "../../../_shared/matchup-grid.js";

const KNOWN_DISPOSITIONS = new Set<string>(DISPOSITIONS);
const KNOWN_TIERS = new Set<IntentTier>(["leaning", "prefer"]);

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  // chunked to avoid arg-count limits on very large plans
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(token: string): Uint8Array {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Team plan → URL-safe compressed token for a `#t=` fragment. */
export function encodePlan(plan: TeamPlan): string {
  return bytesToBase64url(gzipSync(strToU8(JSON.stringify(plan))));
}

export interface DecodeResult {
  plan: TeamPlan;
  /** Faction/detachment ids dropped because the dataset no longer knows them. */
  dropped: string[];
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Compressed token → sanitized plan, or `null` on any malformed input. */
export function decodePlan(token: string): DecodeResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(gunzipSync(base64urlToBytes(token))));
  } catch {
    return null;
  }
  return sanitizePlan(parsed);
}

/**
 * Validate + repair an already-parsed plan object: drop unknown faction and
 * detachment ids (reporting them), coerce fields to safe defaults. Returns
 * `null` when the value isn't a plan-shaped object. Shared by the URL decoder
 * and the localStorage loader.
 */
export function sanitizePlan(parsed: unknown): DecodeResult | null {
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as Record<string, unknown>;
  if (!Array.isArray(raw.players)) return null;

  const dropped: string[] = [];
  const players: Player[] = raw.players.map((entry, i) => {
    const p = (entry ?? {}) as Record<string, unknown>;

    const factionIds = (Array.isArray(p.factionIds) ? p.factionIds : [])
      .filter((f): f is string => typeof f === "string")
      .filter((f) => {
        if (isKnownFaction(f)) return true;
        dropped.push(f);
        return false;
      });

    // Narrowed detachments must resolve within the (surviving) factions.
    let detachmentIds: string[] | null = null;
    if (Array.isArray(p.detachmentIds)) {
      const valid = new Set(detachmentsForFactions(factionIds).map((d) => d.id));
      detachmentIds = p.detachmentIds
        .filter((d): d is string => typeof d === "string")
        .filter((d) => {
          if (valid.has(d)) return true;
          dropped.push(d);
          return false;
        });
    }

    // Intent: keep only known dispositions, with a valid tier, that this
    // (repaired) player can actually field. Unknown disposition keys are
    // reported; invalid tiers / unfieldable dispositions are dropped quietly.
    const intent: Partial<Record<ForceDispositionId, IntentTier>> = {};
    if (p.intent && typeof p.intent === "object") {
      const fieldable = playerCoverage({ id: "", name: "", factionIds, detachmentIds, intent: {} });
      for (const [key, val] of Object.entries(p.intent as Record<string, unknown>)) {
        if (!KNOWN_DISPOSITIONS.has(key)) {
          dropped.push(key);
          continue;
        }
        const d = key as ForceDispositionId;
        if (typeof val === "string" && KNOWN_TIERS.has(val as IntentTier) && fieldable.has(d)) {
          intent[d] = val as IntentTier;
        }
      }
    }

    return {
      id: asString(p.id) || `p${i}`,
      name: asString(p.name),
      factionIds,
      detachmentIds,
      intent,
    };
  });

  const size = raw.size === 8 ? 8 : 5;
  return {
    plan: { teamName: asString(raw.teamName), size, players },
    dropped,
  };
}
