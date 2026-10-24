/**
 * verdict.ts — the pure rules of the `dataslates` pass: whether one record verifies against
 * the dump, and what that verdict does to its `game_version`.
 *
 * A verified record carries the current dump's dataslate. A record that fails verification and
 * claims dump confirmation (a slate in {@link DUMP_CONFIRMED_DATASLATES}) is demoted to the
 * provisional slate; any other unverified record keeps its stamp.
 */
import { hashJson } from "../../round4/hash.js";
import { DUMP_CONFIRMED_DATASLATES, PROVISIONAL_DATASLATE, type GameVersion } from "../dataslate.js";
import type { WeaponProfile } from "../gear-projection.js";

export type StampAction = "promote" | "demote" | "kept" | "untouched";

/**
 * The effect of a verdict on a stamp. `promote`: verified, moves to `now`. `kept`: verified and
 * already `now`. `demote`: unverified and claimed dump confirmation. `untouched`: unverified,
 * already unconfirmed (or unstamped), left as it is.
 */
export function stampAction(
  current: GameVersion | undefined,
  verified: boolean,
  now: GameVersion,
): { action: StampAction; next?: GameVersion } {
  if (!current) return { action: "untouched" };
  if (verified) {
    if (current.edition === now.edition && current.dataslate === now.dataslate) return { action: "kept" };
    return { action: "promote", next: { ...now } };
  }
  if (DUMP_CONFIRMED_DATASLATES.has(current.dataslate)) {
    return { action: "demote", next: { edition: current.edition, dataslate: PROVISIONAL_DATASLATE } };
  }
  return { action: "untouched" };
}

// ── weapons ──

type ProfileLike = Pick<WeaponProfile, "range" | "stats" | "keywords">;

/** Key-sorted JSON of a value, so object member order never decides equality. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** One profile's mechanics: range, non-null stats, and its keyword set. Names are not compared. */
function profileKey(profile: ProfileLike): string {
  const stats = Object.fromEntries(Object.entries(profile.stats ?? {}).filter(([, value]) => value !== null && value !== undefined));
  const keywords = (profile.keywords ?? []).map(canonical).sort();
  return canonical({ range: profile.range, stats, keywords });
}

/**
 * Whether a repo weapon equals the weapon minted from its dump item: same type and the same
 * multiset of profiles (order-insensitive; a null BS/WS counts as absent).
 */
export function weaponMatchesMinted(
  record: { type?: unknown; profiles?: readonly ProfileLike[] },
  minted: { type: string; profiles: readonly ProfileLike[] },
): boolean {
  if (record.type !== minted.type) return false;
  const left = (record.profiles ?? []).map(profileKey).sort();
  const right = minted.profiles.map(profileKey).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

// ── abilities ──

/** The mechanics fields publication writes; a published record equals its compiled entry on all of them. */
export const MECHANICS_FIELDS = ["effect", "scope", "behavior", "trigger", "usage", "applies_to"] as const;

/** The dump prose an ability's record must be digested from. */
export interface FreshSource {
  digest: string;
  sourceHash: string;
  matchHash: string;
}

/** One approved compiled entry of the ability's current source version. */
export interface ApprovedEntry {
  /** The leaves it compiled from are unchanged since approval. */
  inputsCurrent: boolean;
  sourceHash: string;
  matchHash: string;
  mechanics: unknown;
}

export type AbilityRecord = Record<string, unknown> & { stub?: unknown; source_digest?: unknown };

/**
 * Whether an ability record verifies: it is authored (never a stub), its `source_digest` is the
 * digest of the dump prose its owners print now, and it is what publication would write from an
 * approved entry whose source and leaves are unchanged since approval.
 */
export function abilityVerified(
  record: AbilityRecord,
  fresh: FreshSource | null,
  entries: readonly ApprovedEntry[],
  project: (record: Record<string, unknown>, mechanics: never) => Record<string, unknown>,
): boolean {
  if (record.stub === true || !fresh) return false;
  if (typeof record.source_digest !== "string" || record.source_digest !== fresh.digest) return false;
  return entries.some((entry) => {
    if (!entry.inputsCurrent || entry.sourceHash !== fresh.sourceHash || entry.matchHash !== fresh.matchHash) return false;
    const projected = project(record, entry.mechanics as never);
    return MECHANICS_FIELDS.every((field) => hashJson(record[field] ?? null) === hashJson(projected[field] ?? null));
  });
}

// ── detachments and stratagems ──

/** The rule ability ids a detachment names (deprecated singular plus the list). */
export function detachmentRuleIds(record: { detachment_rule_id?: unknown; detachment_rule_ids?: unknown }): string[] {
  const ids = new Set<string>();
  if (typeof record.detachment_rule_id === "string" && record.detachment_rule_id) ids.add(record.detachment_rule_id);
  if (Array.isArray(record.detachment_rule_ids)) {
    for (const id of record.detachment_rule_ids) if (typeof id === "string" && id) ids.add(id);
  }
  return [...ids];
}

/**
 * A detachment verifies when its dump-reconciled fields already match the dump and it names at
 * least one rule ability, every one of which verifies.
 */
export function detachmentVerified(
  fieldsMatch: boolean,
  ruleIds: readonly string[],
  ruleVerified: (abilityId: string) => boolean,
): boolean {
  return fieldsMatch && ruleIds.length > 0 && ruleIds.every(ruleVerified);
}

/** The dump-derived structure of one stratagem (see `buildStratCanon`). */
export interface StratagemStructure {
  cp_cost: number | null;
  player_turn: string | null;
  type: string | null;
  category: string;
  phases_review: readonly string[] | null;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/**
 * Whether a stratagem's structural fields equal the dump: `cp_cost`, `player_turn` and `type`
 * where the dump states them, `category` always, and `phases` against the phases its WHEN line
 * names (a dump that names none verifies only an empty phase list).
 */
export function stratagemStructureMatches(
  record: { cp_cost?: unknown; player_turn?: unknown; type?: unknown; category?: unknown; phases?: unknown },
  dump: StratagemStructure,
): boolean {
  if (dump.cp_cost !== null && record.cp_cost !== dump.cp_cost) return false;
  if (dump.player_turn !== null && record.player_turn !== dump.player_turn) return false;
  if (dump.type !== null && record.type !== dump.type) return false;
  if (record.category !== dump.category) return false;
  const phases = Array.isArray(record.phases) ? record.phases.filter((p): p is string => typeof p === "string") : [];
  return sameSet(phases, dump.phases_review ?? []);
}
