/**
 * Backend-free plan sharing: a team plan JSON-encoded, gzipped, and base64url'd
 * into a `#t=<token>` URL fragment — the same `base64(gzip(...))` shape the
 * list-builder uses for `#list=` links. Opening the link decodes it client-side
 * with no server. Browser-only (btoa/atob); fflate is already a dependency.
 *
 * Decoding is defensive: malformed input yields `null`; faction/detachment ids
 * the current dataset no longer knows are dropped (and reported); and plans from
 * the *old* (pre-army) model are migrated forward instead of discarded, so an
 * old link or a stale localStorage entry still opens with whatever remains valid.
 */
import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";
import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
import type { Army, Placement, Player, PrefTier, TeamPlan } from "./coverage";
import {
  armyDispositions,
  detachmentFaction,
  factionFieldsDetachment,
  detachmentsForFactions,
  isKnownDetachment,
  isKnownFaction,
  sanitizeTeamSize,
  syncPreferences,
} from "./coverage";
import { DISPOSITIONS } from "../../../_shared/matchup-grid.js";

const KNOWN_DISPOSITIONS = new Set<string>(DISPOSITIONS);
const KNOWN_TIERS = new Set<PrefTier>(["could", "pref", "want"]);
/** Old (pre-army) intent tier → new desire tier. */
const LEGACY_TIER: Record<string, PrefTier> = { prefer: "want", leaning: "pref" };

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
  /** Faction/detachment/disposition ids dropped because they no longer resolve. */
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

/** A best-effort id for a migrated/legacy army when the source had none. */
let synthCounter = 0;
function synthId(seed: string): string {
  synthCounter += 1;
  return `mig-${seed}-${synthCounter}`;
}

/**
 * Build a player's army pool from a raw entry. Handles both the current shape
 * (`armies: Army[]`) and the legacy pre-army shape (`detachmentIds` + `intent`),
 * which becomes a single "Army 1" of the old selection (or every faction
 * detachment when the old plan wasn't narrowed). Unknown detachment ids are
 * dropped (and reported); empty armies are discarded.
 */
function sanitizeArmies(
  raw: Record<string, unknown>,
  factionIds: string[],
  dropped: string[],
): Army[] {
  const factionSet = new Set(factionIds);
  const valid = new Set(detachmentsForFactions(factionIds).map((d) => d.id));
  const keepIds = (ids: unknown): string[] =>
    (Array.isArray(ids) ? ids : [])
      .filter((d): d is string => typeof d === "string")
      .filter((d) => {
        if (valid.has(d) && isKnownDetachment(d)) return true;
        dropped.push(d);
        return false;
      });

  if (Array.isArray(raw.armies)) {
    return raw.armies
      .map((entry, i) => {
        const a = (entry ?? {}) as Record<string, unknown>;
        const ids = keepIds(a.detachmentIds);
        // Faction: trust a valid stored one; otherwise (older armies, or a
        // faction since removed) derive it from the first detachment, falling
        // back to the player's first faction.
        const stored = asString(a.factionId);
        const factionId =
          factionSet.has(stored)
            ? stored
            : (ids
                .map((d) => factionIds.find((f) => factionFieldsDetachment(f, d)) ?? detachmentFaction(d))
                .find((f) => f && factionSet.has(f)) ?? factionIds[0] ?? "");
        // An army is single-faction; keep only detachments this faction can field
        // (a generic Codex detachment is shared, so match by faction membership,
        // not by the detachment's owning-faction id).
        const detachmentIds = ids.filter((d) => factionFieldsDetachment(factionId, d));
        return {
          id: asString(a.id) || synthId(`a${i}`),
          name: asString(a.name) || `Army ${i + 1}`,
          factionId,
          detachmentIds,
        };
      })
      .filter((a) => a.factionId !== "" && a.detachmentIds.length > 0);
  }

  // Legacy: `detachmentIds` array = the old narrowed selection; null/absent =
  // "covered all faction detachments". A legacy player could span factions, but
  // an army is single-faction, so group the resolved ids by faction → one army
  // each, in the player's faction order.
  if ("detachmentIds" in raw || "intent" in raw) {
    const ids = Array.isArray(raw.detachmentIds) ? keepIds(raw.detachmentIds) : [...valid];
    return factionIds
      .map((factionId, i) => ({
        id: synthId(`legacy${i}`),
        name: "",
        factionId,
        detachmentIds: ids.filter((d) => factionFieldsDetachment(factionId, d)),
      }))
      .filter((a) => a.detachmentIds.length > 0);
  }

  return [];
}

/**
 * Provided placements (current shape), sanitized to valid `(army, disposition,
 * tier)` triples in their original order. `syncPreferences` later prunes any
 * that the pool can't actually field and appends missing capabilities as
 * `could`, so this only needs to coerce types and report unknown dispositions.
 */
function sanitizePlacements(raw: unknown, dropped: string[]): Placement[] {
  if (!Array.isArray(raw)) return [];
  const out: Placement[] = [];
  for (const entry of raw) {
    const pl = (entry ?? {}) as Record<string, unknown>;
    const armyId = asString(pl.armyId);
    const disposition = asString(pl.disposition);
    const tier = asString(pl.tier);
    if (!armyId) continue;
    if (!KNOWN_DISPOSITIONS.has(disposition)) {
      if (disposition) dropped.push(disposition);
      continue;
    }
    if (!KNOWN_TIERS.has(tier as PrefTier)) continue;
    out.push({ armyId, disposition: disposition as ForceDispositionId, tier: tier as PrefTier });
  }
  return out;
}

/**
 * Apply the legacy `intent` map onto freshly-synced placements: an old
 * `prefer` → `want`, `leaning` → `pref`. The legacy model had a single army, so
 * the disposition alone identifies the placement to retier.
 */
function applyLegacyIntent(prefs: Placement[], rawIntent: unknown, dropped: string[]): Placement[] {
  if (!rawIntent || typeof rawIntent !== "object") return prefs;
  const intent = rawIntent as Record<string, unknown>;
  const tierFor = new Map<string, PrefTier>();
  for (const [key, val] of Object.entries(intent)) {
    if (!KNOWN_DISPOSITIONS.has(key)) {
      dropped.push(key);
      continue;
    }
    const mapped = typeof val === "string" ? LEGACY_TIER[val] : undefined;
    if (mapped) tierFor.set(key, mapped);
  }
  if (tierFor.size === 0) return prefs;
  return prefs.map((pl) => {
    const t = tierFor.get(pl.disposition);
    return t ? { ...pl, tier: t } : pl;
  });
}

/** Keep only locks for a disposition the player covers whose army still exists. */
function sanitizeLocked(
  raw: unknown,
  armies: Army[],
  dropped: string[],
): Partial<Record<ForceDispositionId, string>> {
  const locked: Partial<Record<ForceDispositionId, string>> = {};
  if (!raw || typeof raw !== "object") return locked;
  const byId = new Map(armies.map((a) => [a.id, a]));
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN_DISPOSITIONS.has(key)) {
      dropped.push(key);
      continue;
    }
    const armyId = asString(val);
    const army = byId.get(armyId);
    if (army && armyDispositions(army).has(key as ForceDispositionId)) {
      locked[key as ForceDispositionId] = armyId;
    }
  }
  return locked;
}

/**
 * Validate + repair an already-parsed plan object into the current model: build
 * each player's army pool (migrating the legacy shape forward), reconcile
 * preferences against it, and keep only resolvable locks. Returns `null` when
 * the value isn't a plan-shaped object. Shared by the URL decoder and the
 * localStorage loader.
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

    const armies = sanitizeArmies(p, factionIds, dropped);
    const isLegacy = !Array.isArray(p.armies) && ("detachmentIds" in p || "intent" in p);

    // Seed preferences from the provided placements (current shape) or empty
    // (legacy), then sync against the pool to prune/backfill, then — for legacy —
    // fold the old intent onto the resulting placements.
    const base: Player = {
      id: asString(p.id) || `p${i}`,
      name: asString(p.name),
      factionIds,
      armies,
      preferences: isLegacy ? [] : sanitizePlacements(p.preferences, dropped),
      locked: {},
    };
    base.preferences = syncPreferences(base);
    if (isLegacy) base.preferences = applyLegacyIntent(base.preferences, p.intent, dropped);
    base.locked = isLegacy ? {} : sanitizeLocked(p.locked, armies, dropped);

    return base;
  });

  const size = sanitizeTeamSize(raw.size);
  return {
    plan: { teamName: asString(raw.teamName), size, players },
    dropped,
  };
}
