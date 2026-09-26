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
 *   - everything else (`32mm, 40mm`, `Hull`, `Large Flying Base`, `Unique`,
 *     `None`, null) — no dimensions to attribute: a bare list's order does not
 *     correspond to repo model order, so it is reported, never guessed.
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

/** Every base the dump can express as millimetres: a clean round/oval, else a nominal oval. */
export function parseDumpBaseSize(raw: string | null | undefined): BaseSize | null {
  return parseBaseSize(raw) ?? parseNominalOval(raw);
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
    staged: [],
  };

  // dir → unitId → the datasheet's raw baseSize label (first datasheet wins).
  const rawByDir = new Map<string, Map<string, string | null>>();
  forEachDirDatasheet(dump, ({ dir, ds, unitId }) => {
    const m = rawByDir.get(dir) ?? rawByDir.set(dir, new Map<string, string | null>()).get(dir)!;
    if (!m.has(unitId))
      m.set(unitId, (ds.localisations?.en as { baseSize?: string } | undefined)?.baseSize ?? null);
  });

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
  return report;
}

export function buildBaseSizeReport(report: BaseSizeReport, write: boolean): string {
  const L: string[] = [];
  L.push(`# MFM base sizes — ${write ? "APPLIED" : "DRY RUN"}`);
  L.push("");
  L.push("Reconciles `base_size_mm` on units and unit-composition models from the dump's datasheet");
  L.push("baseSize label. A single clean round/oval is authoritative at both levels (a value within");
  L.push("1 mm on the same shape is kept — the GW app rounds oval dimensions). Labelled per-model");
  L.push("strings are mapped onto composition models by name; bare lists, categories, and null");
  L.push("strings are reported, never guessed. A parsed dump value carries no `draft` flag.");
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
    "Unresolved datasheets (not attributed)",
    report.unresolved.map((u) => `- ${u.dir}/${u.unit} [${u.form}]: ${JSON.stringify(u.raw)}`),
  );
  return L.join("\n") + "\n";
}
