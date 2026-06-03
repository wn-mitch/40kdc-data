/**
 * Bridge GW base-size data onto units and their per-model compositions.
 *
 * Two sources, in priority order:
 *  1. The GW *Chapter Approved Tournament Companion — Base Size Guide* (committed
 *     as numerical-facts rows in `data/base-size-guide.json`). Authoritative for
 *     current matched-play units. Multi-model datasheets list each model as a
 *     "Unit: ModelLabel" row; the bare "Unit" row is the default for unlisted models.
 *  2. bevy-deploy-helper's per-model table, used only as a fallback for the Forge
 *     World / Legends units the tournament guide omits.
 *
 * The match key is the folded datasheet name — 40kdc unit ids are themselves
 * generated from GW names (see `id-generator.ts`), so a direct fold joins exactly.
 * Per-model bases attach to the existing `unit-composition` model entries; the
 * unit-level `base_size_mm` is the representative (most-numerous) model's base.
 *
 * Nothing here touches the filesystem — see `commands/populate-base-sizes.ts`.
 */

/** A resolved base size, shaped to the `base-size` schema def. */
export interface BaseSize {
  shape: "round" | "oval" | "flying-base" | "hull" | "unique";
  diameter?: number;
  width?: number;
  length?: number;
  size?: "small" | "large";
  /** Provisional/guessed (a category without authoritative dims). Omitted when false. */
  draft?: true;
}

/** Fold a display name to the same kebab key `nameToId` produces, but never throws. */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/['‘’]/g, "") // strip apostrophes / curly quotes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type ParseResult =
  | { ok: true; base: BaseSize }
  | { ok: false; reason: "empty" | "unparseable" };

/**
 * Parse a raw base-size string. Tolerant of curly quotes, `×`, decimals, spacing
 * and the "Oval Base" suffix. Categories the guide gives without authoritative
 * millimetres (`Hull`, `Unique`, `Small Flying Base`) parse to draft entries;
 * `Large Flying Base` additionally gets its well-attested 120×92mm oval.
 */
export function parseBaseSize(raw: string): ParseResult {
  const s = (raw ?? "").normalize("NFKC").replace(/[“”‘’]/g, "").trim();
  if (s === "") return { ok: false, reason: "empty" };

  if (/^hull$/i.test(s)) return { ok: true, base: { shape: "hull", draft: true } };
  if (/^unique$/i.test(s)) return { ok: true, base: { shape: "unique", draft: true } };

  const flying = s.match(/^(large|small)\s+flying\s+base$/i);
  if (flying) {
    const size = flying[1].toLowerCase() === "large" ? "large" : "small";
    const base: BaseSize = { shape: "flying-base", size, draft: true };
    // The large flying stem ships on a 120×92mm oval; the small one has no standard mm.
    if (size === "large") {
      base.width = 120;
      base.length = 92;
    }
    return { ok: true, base };
  }

  const oval = s.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*mm/);
  if (oval) return { ok: true, base: { shape: "oval", width: Number(oval[1]), length: Number(oval[2]) } };

  const round = s.match(/(\d+(?:\.\d+)?)\s*mm/);
  if (round) return { ok: true, base: { shape: "round", diameter: Number(round[1]) } };

  return { ok: false, reason: "unparseable" };
}

/** Stable key for comparing two parsed bases (used to detect bevy disagreements). */
function baseKey(b: BaseSize): string {
  switch (b.shape) {
    case "round":
      return `R${b.diameter}`;
    case "oval":
      return `O${b.width}x${b.length}`;
    case "flying-base":
      return `F${b.size}`;
    default:
      return b.shape;
  }
}

/** Footprint area used only to break representative-base ties; categories sort last. */
function baseArea(b: BaseSize): number {
  if (b.shape === "round" && b.diameter) return Math.PI * (b.diameter / 2) ** 2;
  if (b.shape === "oval" && b.width && b.length) return (Math.PI * b.width * b.length) / 4;
  return 0;
}

// ─── Guide index ─────────────────────────────────────────────────────

export interface GuideRow {
  unit: string;
  model?: string;
  raw: string;
}

export interface GuideEntry {
  /** Base from the bare "Unit" row, applied to models without an override. */
  default?: BaseSize;
  /** Per-model overrides, keyed by folded model label. */
  overrides: Map<string, BaseSize>;
}

export interface GuideIndex {
  byUnit: Map<string, GuideEntry>;
  /** Rows whose size string failed to parse (should be empty for guide data). */
  unparsed: GuideRow[];
}

/** Build the guide index from committed rows. Splits "A/B" shared rows on "/". */
export function buildGuideIndex(rows: readonly GuideRow[]): GuideIndex {
  const byUnit = new Map<string, GuideEntry>();
  const unparsed: GuideRow[] = [];

  for (const row of rows) {
    const parsed = parseBaseSize(row.raw);
    if (!parsed.ok) {
      unparsed.push(row);
      continue;
    }
    for (const parent of row.unit.split("/")) {
      const unitId = foldName(parent);
      if (!unitId) continue;
      let entry = byUnit.get(unitId);
      if (!entry) {
        entry = { overrides: new Map() };
        byUnit.set(unitId, entry);
      }
      if (row.model) entry.overrides.set(foldName(row.model), parsed.base);
      else entry.default = parsed.base;
    }
  }
  return { byUnit, unparsed };
}

// ─── bevy fallback index ─────────────────────────────────────────────

export interface BevySources {
  /** bevy Datasheets.json: [{ id, name }]. */
  datasheets: ReadonlyArray<{ id: string; name: string }>;
  /** bevy Datasheets_models.json: [{ datasheet_id, base_size }]. */
  models: ReadonlyArray<{ datasheet_id: string; base_size?: string }>;
}

/**
 * Build a unit-id → base map from bevy, keeping only datasheets whose model rows
 * agree on a single base. Disagreements and pure flying/hull rows collapse to a
 * single value only when unambiguous; otherwise the unit is omitted.
 */
export function buildBevyIndex(src: BevySources): Map<string, BaseSize> {
  const nameById = new Map(src.datasheets.map((d) => [d.id, d.name]));
  const distinctByUnit = new Map<string, Map<string, BaseSize>>();

  for (const m of src.models) {
    const name = nameById.get(m.datasheet_id);
    if (!name) continue;
    const unitId = foldName(name);
    if (!unitId) continue;
    const parsed = parseBaseSize(m.base_size ?? "");
    if (!parsed.ok) continue;
    let seen = distinctByUnit.get(unitId);
    if (!seen) {
      seen = new Map();
      distinctByUnit.set(unitId, seen);
    }
    seen.set(baseKey(parsed.base), parsed.base);
  }

  const index = new Map<string, BaseSize>();
  for (const [unitId, seen] of distinctByUnit) {
    if (seen.size === 1) index.set(unitId, [...seen.values()][0]);
  }
  return index;
}

// ─── Assignment ──────────────────────────────────────────────────────

export interface CompositionModel {
  name: string;
  min: number;
  max: number;
  is_leader_model?: boolean;
}

export interface UnitInput {
  id: string;
  /** Folded composition model list, in declared order. */
  models: CompositionModel[];
}

export interface UnitAssignment {
  /** Representative unit-level base (most-numerous model). Absent if unresolved. */
  unitBase?: BaseSize;
  /** Per-model bases keyed by the model's `name` (only models that resolved). */
  modelBases: Map<string, BaseSize>;
  /** How the unit-level base was sourced. */
  source: "guide" | "bevy" | "none";
}

export interface AssignmentReport {
  /** Units with no base from any source. */
  unmatched: string[];
  /** Units whose base came from the bevy fallback (guide omitted them). */
  bevyFallback: string[];
  /** "unitId: modelName" for composition models that resolved no base. */
  unresolvedModels: string[];
  /** Guide rows whose size string failed to parse. */
  guideUnparsed: GuideRow[];
}

/**
 * Resolve unit-level and per-model bases for every unit.
 *
 * Per model: guide override → guide default → bevy fallback.
 * Unit-level representative: the most-numerous model's base (tie → larger
 * footprint → earliest declared order), so simple consumers get one stable value
 * while the per-model breakdown stays exact.
 */
export function assignBaseSizes(
  units: readonly UnitInput[],
  guide: GuideIndex,
  bevy: Map<string, BaseSize>,
): { assignments: Map<string, UnitAssignment>; report: AssignmentReport } {
  const assignments = new Map<string, UnitAssignment>();
  const report: AssignmentReport = {
    unmatched: [],
    bevyFallback: [],
    unresolvedModels: [],
    guideUnparsed: guide.unparsed,
  };

  for (const unit of units) {
    const entry = guide.byUnit.get(unit.id);
    const bevyBase = bevy.get(unit.id);
    const modelBases = new Map<string, BaseSize>();

    // Per-model resolution.
    for (const model of unit.models) {
      const fromGuide = entry?.overrides.get(foldName(model.name)) ?? entry?.default;
      const base = fromGuide ?? bevyBase;
      if (base) modelBases.set(model.name, base);
      else report.unresolvedModels.push(`${unit.id}: ${model.name}`);
    }

    // Representative unit-level base: most-numerous resolved model.
    let unitBase: BaseSize | undefined;
    const resolved = unit.models
      .map((m, i) => ({ m, i, base: modelBases.get(m.name) }))
      .filter((x): x is { m: CompositionModel; i: number; base: BaseSize } => x.base != null);
    if (resolved.length > 0) {
      resolved.sort((a, b) => b.m.max - a.m.max || baseArea(b.base) - baseArea(a.base) || a.i - b.i);
      unitBase = resolved[0].base;
    } else {
      // No composition model resolved (e.g. empty model list); fall back to unit-level source.
      unitBase = entry?.default ?? bevyBase;
    }

    let source: UnitAssignment["source"] = "none";
    if (unitBase) {
      const fromGuide = entry && (entry.default || entry.overrides.size > 0);
      // The representative came from the guide unless the guide had nothing for this unit.
      source = fromGuide ? "guide" : "bevy";
    }

    if (!unitBase) report.unmatched.push(unit.id);
    else if (source === "bevy") report.bevyFallback.push(unit.id);

    assignments.set(unit.id, { unitBase, modelBases, source });
  }

  return { assignments, report };
}
