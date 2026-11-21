/**
 * base-sizes.ts — reconcile `base_size_mm` on units and their composition models
 * against the GW MFM dump's per-datasheet base-size label (the `base-sizes`
 * subcommand).
 *
 * The dump exposes `datasheet.localisations.en.baseSize` as a display string in
 * three shapes:
 *   - one uniform value (`40mm`, `120 x 92mm Oval Base`) — authoritative for the
 *     unit's representative base AND for every one of its composition models;
 *   - a labelled per-model list (`Sword Brother: 40mm\nInitiates: 32mm`) — each
 *     label is resolved onto a composition model by name (see
 *     {@link baseSizeLabelMatches}) and only that model's base is reconciled;
 *   - a bare list (`28.5mm, 32mm, 40mm`) — sorted by size, so it attributes
 *     nothing, but it rules out unlisted sizes: authored bases that contradict
 *     it (an unlisted size, or a listed size no model has) are marked draft;
 *   - everything else (`Hull`, `Large Flying Base`, `Unique`, `None`, null) —
 *     no dimensions to attribute, so it is reported, never guessed.
 *
 * Reconcile precedence per value:
 *   - no authored value                                   → FILL
 *   - authored == dump, was draft                         → DE-DRAFT
 *   - authored == dump, not draft                         → confirm
 *   - authored within 1 mm of the dump on the same shape  → KEEP (the GW app
 *     rounds oval dimensions, so 75x42 vs the dump's 74x42 is not a correction)
 *   - otherwise                                           → CORRECT
 *
 * A dump-parsed value is written with no `draft` flag.
 *
 * Datasheet→repo-unit matching reuses {@link forEachDirDatasheet} (home faction
 * first, shared-roster fallback), so it can't drift from the wargear reconcile.
 * Mutations are applied in BOTH dry-run and write modes and routed through
 * {@link applyWrites}, which validates the projected dataset and only persists on
 * --write.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import { MfmDump } from "./loader.js";
import { CORE_DIR, readJsonArray } from "./repo-files.js";
import { forEachDirDatasheet, withinEditDistance1 } from "./wargear.js";
import { nameToId } from "../converters/id-generator.js";
import type { StagedWrite } from "./apply.js";

export interface BaseSize {
  shape: "round" | "oval" | "flying-base" | "hull" | "unique";
  diameter?: number;
  width?: number;
  length?: number;
  size?: "small" | "large";
  draft?: boolean;
}

/**
 * Parse a dump `baseSize` label to a repo base-size object — confident
 * millimetre dimensions only. Returns null for categories, per-model/multi
 * strings, and single-number ovals (see {@link parseNominalOval}).
 */
export function parseBaseSize(raw: string | null | undefined): BaseSize | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  // Reject per-model / multi strings and empties up front.
  if (s === "" || /[,:\n]/.test(s)) return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
  if (m) return { shape: "round", diameter: parseFloat(m[1]) };
  m = s.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*mm(?:\s+oval\s+base)?$/i);
  if (m) return { shape: "oval", width: parseFloat(m[1]), length: parseFloat(m[2]) };
  return null;
}

/** Dimensional equality (shape + mm), ignoring the draft flag. */
export function baseSizeEqual(a: BaseSize | undefined | null, b: BaseSize): boolean {
  if (!a || a.shape !== b.shape) return false;
  if (b.shape === "round") return a.diameter === b.diameter;
  if (b.shape === "oval") return a.width === b.width && a.length === b.length;
  return false; // only round/oval are dump-derived
}

/**
 * GW's nominal oval shorthand → the dimensions the base-size guide gives for
 * that base (`105mm oval` = "105x70mm Oval Base", `150mm Oval Base` =
 * "150x95mm Oval Base"). Only these two nominal ovals exist in the dump.
 */
const GW_NOMINAL_OVALS: Record<string, readonly [number, number]> = {
  "105": [105, 70],
  "150": [150, 95],
};

/** Resolve the dump's single-number oval shorthand ("105mm oval", "150mm Oval Base"). */
export function parseNominalOval(raw: string | null | undefined): BaseSize | null {
  if (raw == null) return null;
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*mm\s+oval(?:\s+base)?$/i);
  if (!m) return null;
  const dims = GW_NOMINAL_OVALS[m[1]];
  return dims ? { shape: "oval", width: dims[0], length: dims[1] } : null;
}

/**
 * Bare single-number labels that name an oval, not a round base. GW makes no 75mm or 120mm round
 * base; the dump prints these only on Deffkoptas (75x42 oval) and the Ork flyers (120x92, the size
 * the same-chassis Wazbom Blastajet prints in full).
 */
const GW_BARE_OVALS: Record<string, readonly [number, number]> = {
  "75": [75, 42],
  "120": [120, 92],
};

/** Resolve a bare oval shorthand ("75mm", "120mm"); null for any other label. */
export function parseBareOval(raw: string | null | undefined): BaseSize | null {
  if (raw == null) return null;
  const m = String(raw).trim().match(/^(\d+)\s*mm$/i);
  const dims = m ? GW_BARE_OVALS[m[1]] : undefined;
  return dims ? { shape: "oval", width: dims[0], length: dims[1] } : null;
}

/** Every base the dump can express as millimetres: a bare oval shorthand, a clean round/oval, else a nominal oval. */
export function parseDumpBaseSize(raw: string | null | undefined): BaseSize | null {
  return parseBareOval(raw) ?? parseBaseSize(raw) ?? parseNominalOval(raw);
}

/**
 * A bare list's sizes ("28.5mm, 32mm, 40mm"): one line, comma-separated, every item a size. The
 * dump sorts the list by size, not by model, so it says which sizes the unit's models use but not
 * which model uses which. Null for anything else.
 */
export function parseBareBaseSizeList(raw: string | null | undefined): BaseSize[] | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (/[:\n]/.test(text) || !text.includes(",")) return null;
  const sizes = text.split(",").map((item) => parseDumpBaseSize(item.trim()));
  return sizes.every((size): size is BaseSize => size !== null) ? sizes : null;
}

/** A reviewed attribution of a bare list's sizes to a unit's models (bare-list-bases.json). */
export interface BareListAttribution {
  /** The dump label the attribution was reviewed against, verbatim. */
  list: string;
  /** The unit's representative (bulk model) base. */
  unit: string;
  /** Every composition model's base, by model name. */
  models: Record<string, string>;
}

/** Reviewed attributions by `<dir>/<unit>`. */
export const BARE_LIST_ATTRIBUTIONS: Readonly<Record<string, BareListAttribution>> = (() => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "bare-list-bases.json");
  const { $comment: _comment, ...entries } = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  return entries as Record<string, BareListAttribution>;
})();

/**
 * Why a reviewed attribution does not hold for the dump label and the unit's models, or null when it
 * does: the label must be the one reviewed, every model must be attributed (and nothing else), and
 * the attributed sizes must be exactly the label's sizes.
 */
export function bareListAttributionProblem(attribution: BareListAttribution, raw: string, modelNames: readonly string[]): string | null {
  if (raw.trim() !== attribution.list) return `dump now prints ${JSON.stringify(raw.trim())}, reviewed against ${JSON.stringify(attribution.list)}`;
  const sizes = parseBareBaseSizeList(raw);
  if (!sizes) return "dump label is not a bare list";
  const missing = modelNames.filter((name) => !(name in attribution.models));
  if (missing.length) return `no base for ${missing.join(", ")}`;
  const extra = Object.keys(attribution.models).filter((name) => !modelNames.includes(name));
  if (extra.length) return `no composition model named ${extra.join(", ")}`;
  const bases = [...Object.values(attribution.models), attribution.unit].map((text) => parseDumpBaseSize(text));
  if (bases.some((base) => base === null)) return "an attributed base does not parse";
  const modelBases = bases.slice(0, -1) as BaseSize[];
  if (!bareListConsistent(modelBases, sizes)) return "attributed sizes are not exactly the listed sizes";
  if (!listed(bases.at(-1)!, sizes)) return "the unit base is not a listed size";
  return null;
}

/** Whether an authored base is one of a bare list's sizes (within the app's rounding slack). */
const listed = (base: BaseSize, sizes: readonly BaseSize[]): boolean =>
  sizes.some((size) => baseSizeEqual(base, size) || baseSizesWithinRounding(base, size));

/**
 * Whether a unit's authored model bases agree with a bare list: every authored base is a listed
 * size, and, once every model has a base, every listed size is on some model. Models without a base
 * are not evidence either way.
 */
export function bareListConsistent(bases: readonly (BaseSize | null | undefined)[], sizes: readonly BaseSize[]): boolean {
  const authored = bases.filter((base): base is BaseSize => base != null);
  if (!authored.every((base) => listed(base, sizes))) return false;
  if (authored.length < bases.length) return true;
  return sizes.every((size) => authored.some((base) => listed(base, [size])));
}

export interface LabelledBase {
  /** Candidate model-name labels on this line, split on `,`, `:`, and `/`. */
  labels: string[];
  base: BaseSize;
  /** True for the dump's catch-all "Other models" line. */
  otherModels: boolean;
}

/**
 * Parse a per-model dump baseSize ("Sword Brother: 40mm\nInitiates: 32mm").
 * Returns null unless every line is `<labels>: <size>` with a parseable size —
 * so bare lists ("32mm, 40mm") and categories ("Hull") return null and are
 * reported as unresolved instead.
 */
export function parseLabelledBaseSizes(raw: string | null | undefined): LabelledBase[] | null {
  if (raw == null) return null;
  const lines = String(raw)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const out: LabelledBase[] = [];
  for (const line of lines) {
    const idx = line.lastIndexOf(":");
    if (idx < 0) return null;
    const base = parseDumpBaseSize(line.slice(idx + 1));
    if (!base) return null;
    const labels = line
      .slice(0, idx)
      .split(/[,/:]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (labels.length === 0) return null;
    out.push({ labels, base, otherModels: labels.some((l) => /^other models$/i.test(l)) });
  }
  return out;
}

/** Same shape, every dimension within 1 mm — the GW app's oval rounding slack. */
export function baseSizesWithinRounding(a: BaseSize | undefined | null, b: BaseSize): boolean {
  if (!a || a.shape !== b.shape) return false;
  if (b.shape === "round") return a.diameter != null && b.diameter != null && Math.abs(a.diameter - b.diameter) <= 1;
  if (b.shape === "oval")
    return (
      a.width != null && a.length != null && b.width != null && b.length != null &&
      Math.abs(a.width - b.width) <= 1 && Math.abs(a.length - b.length) <= 1
    );
  return false;
}

/** What a dump-derived base does to the value already authored for a unit or model. */
export type BaseSizeDecision = "fill" | "dedraft" | "confirm" | "rounding-kept" | "correct";

/**
 * The reconcile policy in one place: a dump base fills an empty slot, de-drafts a
 * provisional one, confirms an equal one — and otherwise corrects, because the MFM
 * is authoritative. Only an authored value inside the dump's own rounding slack
 * survives ("rounding-kept").
 */
export function baseSizeDecision(current: BaseSize | null | undefined, want: BaseSize): BaseSizeDecision {
  if (!current) return "fill";
  if (baseSizeEqual(current, want)) return current.draft ? "dedraft" : "confirm";
  if (baseSizesWithinRounding(current, want)) return "rounding-kept";
  return "correct";
}

/** Kebab slug of a name, falling back to a plain slug for names `nameToId` rejects. */
function baseSizeNameKey(value: string): string {
  try {
    return nameToId(value);
  } catch {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}

/** Per-token singularisation so "Ratlings" and "Ratling Sniper" share a stem. */
function singulariseToken(t: string): string {
  if (t.length > 3 && t.endsWith("ves")) return t.slice(0, -3) + "f";
  if (t.length > 3 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 2 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

/** Singularised slug, compared token-wise so plural/label drift cancels out. */
function baseSizeCanonical(value: string): string {
  return baseSizeNameKey(value).split("-").map(singulariseToken).join("-");
}

/**
 * True when a dump model label denotes a repo composition model. The ladder is
 * deliberately conservative — slug equality, singularised equality, one edit
 * away, or a hyphen-boundary prefix/suffix — and only in the directions where
 * the model name is at least as long as the label, so a qualifier-bearing label
 * ("Kill Team Infiltrators with bolt sniper rifles") cannot claim the base model
 * and starve the dump's `Other models` line.
 */
export function baseSizeLabelMatches(label: string, modelName: string): boolean {
  const L = baseSizeNameKey(label);
  const M = baseSizeNameKey(modelName);
  if (!L || !M) return false;
  if (L === M) return true;
  const C = baseSizeCanonical(L);
  const D = baseSizeCanonical(M);
  if (C === D) return true;
  if (withinEditDistance1(C, D)) return true;
  const boundary = (x: string, y: string) =>
    y.startsWith(x + "-") || y.endsWith("-" + x) || x.endsWith("-" + y);
  return boundary(L, M) || boundary(C, D);
}

/** Unit-level anchors: `base_size_mm` is inserted after the first present one. */
const UNIT_BASE_ANCHORS = ["faction_keywords", "keywords", "profiles"];
/** Composition-model anchors, same rule. */
const MODEL_BASE_ANCHORS = ["is_leader_model", "default_weapon_ids", "max", "min"];

/**
 * Set `base_size_mm` on `obj`, inserting it after the first present anchor key the
 * first time so the on-disk key order stays stable (rebuilding an existing
 * `base_size_mm` in place instead).
 */
function withBaseSize(obj: Record<string, unknown>, value: BaseSize, anchors: string[]): void {
  if ("base_size_mm" in obj) {
    obj.base_size_mm = { ...value };
    return;
  }
  const anchor = anchors.find((k) => k in obj);
  if (!anchor) {
    obj.base_size_mm = { ...value };
    return;
  }
  const rebuilt: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    rebuilt[k] = v;
    if (k === anchor) rebuilt.base_size_mm = { ...value };
  }
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, rebuilt);
}

interface UnitRecord {
  id: string;
  base_size_mm?: BaseSize | null;
  [k: string]: unknown;
}

interface CompositionModelRecord {
  name: string;
  base_size_mm?: BaseSize | null;
  [k: string]: unknown;
}

interface CompositionRecord {
  unit_id: string;
  models: CompositionModelRecord[];
  [k: string]: unknown;
}

export interface BaseSizeChange {
  dir: string;
  unit: string;
  /** Composition model name; absent for a unit-level change. */
  model?: string;
  from: string;
  to: string;
}

/** Why a datasheet's baseSize could not be attributed. */
export type BaseSizeForm = "list" | "category" | "null";

export interface BaseSizeReport {
  filled: BaseSizeChange[];
  corrected: BaseSizeChange[];
  dedrafted: BaseSizeChange[];
  roundingKept: BaseSizeChange[];
  confirmed: { units: number; models: number };
  labelUnmatched: { dir: string; unit: string; label: string; base: string }[];
  labelConflicts: { dir: string; unit: string; model: string; candidates: string[] }[];
  representativeUnresolved: { dir: string; unit: string; authored: string; labelled: string[] }[];
  unresolved: { dir: string; unit: string; form: BaseSizeForm; raw: string | null }[];
  /** Authored bases a bare list contradicts, marked draft (the list cannot say which model is which). */
  listDrafted: BaseSizeChange[];
  /** Bare-list units whose bases a reviewed attribution supplied. */
  listAttributed: string[];
  /** Reviewed attributions that no longer hold, and why (the unit falls back to the draft check). */
  attributionRefused: { dir: string; unit: string; reason: string }[];
  /** Reviewed attributions for a unit no bare-list datasheet reaches. */
  attributionUnused: string[];
  staged: StagedWrite[];
}

/** Human-readable base geometry for reports, including the authored value's own shape. */
const fmt = (b: BaseSize | null | undefined): string => {
  if (!b) return "none";
  if (b.shape === "round") return `round ${b.diameter}`;
  if (b.shape === "oval") return `oval ${b.width}x${b.length}`;
  if (b.shape === "flying-base") return b.size ? `flying-base:${b.size}` : "flying-base";
  return b.shape;
};

export function runBaseSizes(dump: MfmDump): BaseSizeReport {
  const report: BaseSizeReport = {
    filled: [],
    corrected: [],
    dedrafted: [],
    roundingKept: [],
    confirmed: { units: 0, models: 0 },
    labelUnmatched: [],
    labelConflicts: [],
    representativeUnresolved: [],
    unresolved: [],
    listDrafted: [],
    listAttributed: [],
    attributionRefused: [],
    attributionUnused: [],
    staged: [],
  };

  // dir → unitId → the datasheet's raw baseSize label (first datasheet wins).
  const rawByDir = new Map<string, Map<string, string | null>>();
  forEachDirDatasheet(dump, ({ dir, ds, unitId }) => {
    const m = rawByDir.get(dir) ?? rawByDir.set(dir, new Map<string, string | null>()).get(dir)!;
    if (!m.has(unitId))
      m.set(unitId, (ds.localisations?.en as { baseSize?: string } | undefined)?.baseSize ?? null);
  });

  const attributionsReached = new Set<string>();
  for (const [dir, rawByUnit] of rawByDir) {
    const upath = path.join(CORE_DIR, dir, "units.json");
    if (!fs.existsSync(upath)) continue;
    const units = readJsonArray<UnitRecord>(upath);
    const unitIndex = new Map(units.map((u, i) => [u.id, i]));
    const cpath = path.join(CORE_DIR, dir, "unit-compositions.json");
    const comps = readJsonArray<CompositionRecord>(cpath);
    const compIndex = new Map(comps.map((c, i) => [c.unit_id, i]));
    let unitsDirty = false;
    let compsDirty = false;

    const change = (
      list: BaseSizeChange[],
      unit: string,
      model: string | undefined,
      from: BaseSize | null | undefined,
      to: BaseSize | null | undefined,
    ): void => {
      const from_ = fmt(from);
      const to_ = fmt(to);
      list.push(model === undefined ? { dir, unit, from: from_, to: to_ } : { dir, unit, model, from: from_, to: to_ });
    };

    /** Reconcile one unit or composition model; returns true when it was written. */
    const applySlot = (
      obj: Record<string, unknown>,
      want: BaseSize,
      anchors: string[],
      unit: string,
      model: string | undefined,
    ): boolean => {
      const cur = obj.base_size_mm as BaseSize | null | undefined;
      switch (baseSizeDecision(cur, want)) {
        case "fill":
          change(report.filled, unit, model, cur, want);
          withBaseSize(obj, { ...want }, anchors);
          return true;
        case "dedraft":
          if (cur) delete cur.draft;
          change(report.dedrafted, unit, model, cur, want);
          return true;
        case "confirm":
          if (model === undefined) report.confirmed.units++;
          else report.confirmed.models++;
          return false;
        case "rounding-kept":
          change(report.roundingKept, unit, model, cur, want);
          return false;
        case "correct":
          change(report.corrected, unit, model, cur, want);
          obj.base_size_mm = { ...want };
          return true;
      }
    };

    for (const [unit, raw] of rawByUnit) {
      const ui = unitIndex.get(unit);
      if (ui === undefined) continue;
      const u = units[ui];
      const ci = compIndex.get(unit);
      const models: CompositionModelRecord[] = ci === undefined ? [] : comps[ci].models;

      const uniform = parseDumpBaseSize(raw);
      if (uniform) {
        if (applySlot(u, uniform, UNIT_BASE_ANCHORS, unit, undefined)) unitsDirty = true;
        for (const m of models) {
          if (applySlot(m, uniform, MODEL_BASE_ANCHORS, unit, m.name)) compsDirty = true;
        }
        continue;
      }

      // A bare list cannot attribute a size to a model, but it rules out bases it does not list. When the
      // authored bases contradict it, no value can be trusted to be the right model's: mark them draft.
      const sizes = parseBareBaseSizeList(raw);
      if (sizes) {
        const key = `${dir}/${unit}`;
        const attribution = BARE_LIST_ATTRIBUTIONS[key];
        if (attribution) {
          attributionsReached.add(key);
          const problem = bareListAttributionProblem(attribution, String(raw), models.map((m) => m.name));
          if (problem === null) {
            for (const m of models) {
              if (applySlot(m, parseDumpBaseSize(attribution.models[m.name])!, MODEL_BASE_ANCHORS, unit, m.name)) compsDirty = true;
            }
            if (applySlot(u, parseDumpBaseSize(attribution.unit)!, UNIT_BASE_ANCHORS, unit, undefined)) unitsDirty = true;
            report.listAttributed.push(key);
            continue;
          }
          report.attributionRefused.push({ dir, unit, reason: problem });
        }
        const consistent = bareListConsistent(models.map((m) => m.base_size_mm), sizes);
        const draftSlot = (obj: { base_size_mm?: BaseSize | null }, model: string | undefined): void => {
          const cur = obj.base_size_mm;
          if (!cur || cur.draft) return;
          cur.draft = true;
          report.listDrafted.push(model === undefined ? { dir, unit, from: fmt(cur), to: "draft" } : { dir, unit, model, from: fmt(cur), to: "draft" });
          if (model === undefined) unitsDirty = true;
          else compsDirty = true;
        };
        if (!consistent) for (const m of models) draftSlot(m, m.name);
        if (!consistent || (u.base_size_mm != null && !listed(u.base_size_mm, sizes))) draftSlot(u, undefined);
        report.unresolved.push({ dir, unit, form: "list", raw: String(raw).trim() });
        continue;
      }

      const labelled = parseLabelledBaseSizes(raw);
      if (!labelled) {
        const text = (raw ?? "").trim();
        const listish = /,/.test(text) || /\n/.test(text);
        report.unresolved.push({
          dir,
          unit,
          form: text === "" ? "null" : listish && /mm/i.test(text) ? "list" : "category",
          raw: text === "" ? null : text,
        });
        continue;
      }

      // modelName → rendered base → base, so distinct lines for one model collide here.
      const claimed = new Map<string, Map<string, BaseSize>>();
      const claim = (modelName: string, base: BaseSize): void => {
        const m = claimed.get(modelName) ?? claimed.set(modelName, new Map<string, BaseSize>()).get(modelName)!;
        m.set(fmt(base), base);
      };
      for (const line of labelled) {
        if (line.otherModels) continue;
        for (const label of line.labels) {
          const hits = models.filter((m) => baseSizeLabelMatches(label, m.name));
          if (hits.length === 0) {
            report.labelUnmatched.push({ dir, unit, label, base: fmt(line.base) });
            continue;
          }
          for (const m of hits) claim(m.name, line.base);
        }
      }
      // The catch-all line covers only models no explicit label reached.
      for (const line of labelled) {
        if (!line.otherModels) continue;
        for (const m of models) if (!claimed.has(m.name)) claim(m.name, line.base);
      }

      const allClaimed = new Map<string, BaseSize>();
      for (const c of claimed.values()) for (const [k, b] of c) allClaimed.set(k, b);
      for (const m of models) {
        const c = claimed.get(m.name);
        if (!c) continue;
        if (c.size > 1) {
          report.labelConflicts.push({ dir, unit, model: m.name, candidates: [...c.keys()].sort() });
          continue;
        }
        if (applySlot(m, [...c.values()][0], MODEL_BASE_ANCHORS, unit, m.name)) compsDirty = true;
      }

      // A labelled datasheet cannot name the unit's representative base: verify
      // whatever is authored against the claimed bases and report it when it isn't one.
      const authored = u.base_size_mm;
      if (!authored || ![...allClaimed.values()].some((b) => baseSizeEqual(authored, b))) {
        report.representativeUnresolved.push({
          dir,
          unit,
          authored: fmt(authored),
          labelled: [...allClaimed.keys()].sort(),
        });
      }
    }

    if (unitsDirty) report.staged.push({ path: upath, value: units });
    if (compsDirty && fs.existsSync(cpath)) report.staged.push({ path: cpath, value: comps });
  }
  report.attributionUnused = Object.keys(BARE_LIST_ATTRIBUTIONS).filter((key) => !attributionsReached.has(key)).sort();
  return report;
}

export function buildBaseSizeReport(report: BaseSizeReport, write: boolean): string {
  const L: string[] = [];
  L.push(`# MFM base sizes — ${write ? "APPLIED" : "DRY RUN"}`);
  L.push("");
  L.push("Reconciles `base_size_mm` on units and unit-composition models from the dump's datasheet");
  L.push("baseSize label. A single clean round/oval is authoritative at both levels (a value within");
  L.push("1 mm on the same shape is kept — the GW app rounds oval dimensions). Labelled per-model");
  L.push("strings are mapped onto composition models by name. A bare list attributes nothing, but");
  L.push("authored bases it contradicts are marked draft. Categories and null strings are reported,");
  L.push("never guessed. A parsed dump value carries no `draft` flag.");
  L.push("");
  L.push("| Metric | Count |");
  L.push("|---|--:|");
  L.push(`| Filled | ${report.filled.length} |`);
  L.push(`| Corrected | ${report.corrected.length} |`);
  L.push(`| De-drafted | ${report.dedrafted.length} |`);
  L.push(`| Rounding kept (authored kept) | ${report.roundingKept.length} |`);
  L.push(`| Confirmed (units) | ${report.confirmed.units} |`);
  L.push(`| Confirmed (models) | ${report.confirmed.models} |`);
  L.push(`| Unmatched labels | ${report.labelUnmatched.length} |`);
  L.push(`| Conflicting labels | ${report.labelConflicts.length} |`);
  L.push(`| Representative unresolved | ${report.representativeUnresolved.length} |`);
  L.push(`| Unresolved (list/category/null) | ${report.unresolved.length} |`);
  L.push(`| Drafted (contradicts a bare list) | ${report.listDrafted.length} |`);
  L.push(`| Attributed bare lists (reviewed) | ${report.listAttributed.length} |`);
  L.push(`| Attributions refused / unused | ${report.attributionRefused.length} / ${report.attributionUnused.length} |`);
  L.push("");

  const section = (title: string, lines: string[]): void => {
    if (lines.length === 0) return;
    L.push(`## ${title}`, "");
    L.push(...lines);
    L.push("");
  };
  const at = (c: BaseSizeChange): string => (c.model === undefined ? c.unit : `${c.unit} :: ${c.model}`);
  const moved = (c: BaseSizeChange): string => `- ${c.dir}/${at(c)}: ${c.from} → ${c.to}`;

  section("Filled (was empty)", report.filled.map(moved));
  section("Corrected (dump authoritative)", report.corrected.map(moved));
  section("De-drafted (dump confirmed a provisional value)", report.dedrafted.map(moved));
  section(
    "Rounding kept (authored value kept — within 1 mm of the dump)",
    report.roundingKept.map((c) => `- ${c.dir}/${at(c)}: authored ${c.from} vs dump ${c.to}`),
  );
  section(
    "Unmatched labels (not attributed)",
    report.labelUnmatched.map((l) => `- ${l.dir}/${l.unit}: "${l.label}" (${l.base})`),
  );
  section(
    "Conflicting labels (two labels disagree on one model — not changed)",
    report.labelConflicts.map((c) => `- ${c.dir}/${c.unit} :: ${c.model}: ${c.candidates.join(" vs ")}`),
  );
  section(
    "Representative unresolved (labelled datasheet — unit base not derived)",
    report.representativeUnresolved.map(
      (r) => `- ${r.dir}/${r.unit}: authored ${r.authored}, labelled ${r.labelled.join(", ") || "none"}`,
    ),
  );
  section(
    "Attributions refused (reviewed attribution no longer holds — re-review bare-list-bases.json)",
    report.attributionRefused.map((r) => `- ${r.dir}/${r.unit}: ${r.reason}`),
  );
  section(
    "Attributions unused (no bare-list datasheet reaches the unit)",
    report.attributionUnused.map((key) => `- ${key}`),
  );
  section(
    "Drafted (authored bases a bare list contradicts — which model is which is unknown)",
    report.listDrafted.map((c) => `- ${c.dir}/${at(c)}: ${c.from}`),
  );
  section(
    "Unresolved datasheets (not attributed)",
    report.unresolved.map((u) => `- ${u.dir}/${u.unit} [${u.form}]: ${JSON.stringify(u.raw)}`),
  );
  return L.join("\n") + "\n";
}
