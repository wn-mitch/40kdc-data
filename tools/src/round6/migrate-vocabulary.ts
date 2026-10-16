/**
 * Project the complete vocabulary cutover before validating or writing any data.
 * Existing pointer overrides normalize historical input first; canonical transforms
 * then run over the resulting tree. Ambiguities retain record/pointer diagnostics.
 * Production persistence uses the MFM staged-write seam, including stale-input refusal.
 * No-op production runs still validate every core/enrichment input. Fixture-only
 * projection is separate and never authorizes production writes. Inspection
 * snapshots preserve registry bytes but are not publication-qualified datasets.
 *
 * Usage: npx tsx tools/src/round6/migrate-vocabulary.ts [--write] [--review <out.json>]
 *   [--projection <out.json>] [--staging-root <new-directory>] [--data-root <directory>] [paths…]
 */
import * as fs from "fs";
import * as path from "path";

import { buildReferenceVocabularies } from "../audit-dangling-refs.js";
import { formatCompact } from "../compact-json.js";
import { createValidator } from "../schema-loader.js";
import { keywordIndex } from "../round5c/core-keywords.js";
import { DEFAULT_DUMP_PATH } from "../mfm/loader.js";
import { loadRepoProse, type RepoProse } from "../mfm/record-prose.js";
import { storeSource } from "../mfm/store-source.js";
import { applyReplacements, type Replacement } from "./json-spans.js";
import { LEGACY_TYPES, migrateSimple, type KeywordSets, type Place, type Node, type Outcome } from "./vocab-conditions.js";
import { migrateTrigger } from "./vocab-triggers.js";
import { LEGACY_ONLY_TYPES, LEGACY_TARGETS, migrateEffect, migrateMovement, targetRef, type EffectContext } from "./vocab-effects.js";
import { prepareVocabulary, projectVocabulary, type VocabularyProjection } from "./vocab-projection.js";
import { prepareWrites, type StagedWrite } from "../mfm/apply.js";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SCHEMAS = path.join(REPO, "schemas");

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

const NEW_TYPES = new Set(
  (loadJson<Node>(path.join(SCHEMAS, "enrichment/ability-dsl/condition.schema.json")) as { $defs: { "simple-condition": { oneOf: Array<{ properties: { type: { const: string } } }> } } })
    .$defs["simple-condition"].oneOf.map((v) => v.properties.type.const),
);
const NEW_EVENTS = new Set((loadJson<Node>(path.join(SCHEMAS, "$defs/common.schema.json")) as { $defs: { "game-event": { enum: string[] } } }).$defs["game-event"].enum);
/** Types whose legacy and new forms share a name; the rules still normalise their parameters. */
const SHARED = new Set(["phase-is", "player-turn-is", "battle-round", "operation-markers", "engagement-fronts", "destroyed-while-on-objective", "destroyed-in-tagged-terrain"]);

const NEW_SINGLE = createValidator({ allErrors: false }).getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/single-effect")!;
const CONTAINERS = new Set(["aura", "conditional", "sequence", "choice", "select-units", "for-each-unit", "dice-gated", "dice-table", "dice-pool-allocation",
  "rules-bundle", "ability-part", "stance-select", "stance-selection-capacity", "resource-action-menu", "named-region-state", "named-objective-state",
  "designate-target", "persistent-designation", "issue-orders", "risk-reward", "no-effect", "leader-model-ability-grant"]);
const CONDITION_SLOTS = new Set(["condition", "eligibility", "qualified_condition", "requires", "attack_condition", "observer_eligibility", "units", "completes", "restrictions", "when"]);
const TRIGGER_SLOTS = new Set(["trigger", "when"]);

export type Review = { file: string; record: string; pointer: string; reason: string; node: unknown; target?: unknown; ability_type?: string; within?: string };

async function keywordSets(): Promise<KeywordSets> {
  const unit = keywordIndex(path.join(REPO, "data"));
  const weapon = new Set(loadJson<Array<{ name: string }>>(path.join(REPO, "data/core/weapon-keywords.json")).map((w) => w.name.toUpperCase()));
  const tags = new Set(["RILED UP", "SPOTTED", "AFFLICTED", "GUIDED", "HIDDEN", "MARKED", "OATH OF MOMENT TARGET"]);
  const known = (await buildReferenceVocabularies(path.join(REPO, "data"))).keywords;
  const abilities = new Set<string>();
  const enr = path.join(REPO, "data/enrichment");
  for (const d of fs.readdirSync(enr)) {
    const f = path.join(enr, d, "abilities.json");
    if (fs.existsSync(f)) for (const a of loadJson<Node[]>(f)) abilities.add(String(a.ability_id ?? a.id));
  }
  return { unit, weapon, tags, known, abilities };
}

const isCondition = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && !Array.isArray(v) && (typeof (v as Node).type === "string" || typeof (v as Node).operator === "string");
const isTrigger = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Node).event === "string";

class Migrator {
  reviews: Review[] = [];
  changed = 0;
  /** Path segments before the record (1 for an array file's index, 0 for a root object). */
  private base = 1;
  /** The ability being walked: its scope and rule text feed effect targets. */
  private effectCtx: EffectContext & { ruleText?: string } = {};
  constructor(
    private sets: KeywordSets,
    private overrides: Record<string, unknown>,
    /** Rule text keyed by `<faction>/<ability_id>` ({@link dumpRuleText}). */
    private ruleText: ReadonlyMap<string, string> = new Map(),
  ) {}

  /** A single legacy effect node: a legacy-only type, or a shared type with a legacy target. */
  private isLegacyEffect(v: Node): boolean {
    const t = String(v.type);
    // A node the new vocabulary already accepts is not legacy.
    if (NEW_SINGLE(v)) return false;
    if (t === "movement-modifier") return true;
    // Containers keep their shape in this pass; only single effects move.
    if (!("target" in v) || CONTAINERS.has(t)) return false;
    if (LEGACY_ONLY_TYPES.has(t)) return true;
    if (typeof v.target === "string" && LEGACY_TARGETS.has(v.target)) return true;
    // attacker / defender are spelled the same in both vocabularies; legacy modifier keys tell them apart.
    const m = (v.modifier ?? {}) as Node;
    return ["attack_type", "grant_type", "pool_id", "resource"].some((k) => k in m) || (t === "ability-grant" && "ability_id" in m);
  }

  effect(v: Node, file: string, record: string, pointer: string): Outcome {
    const override = this.overrides[this.key(file, record, pointer)];
    if (override !== undefined) return { node: override as Node };
    const r = v.type === "movement-modifier" ? migrateMovement(v, this.effectCtx) : migrateEffect(v, this.effectCtx);
    if ("review" in r) this.reviews.push({ file, record, pointer, reason: r.review, node: v, target: targetRef(v.target, this.effectCtx), ability_type: this.effectCtx.abilityType, within: this.effectCtx.within });
    return r;
  }

  private key(file: string, record: string, pointer: string): string {
    return `${file}#${record}#${pointer}`;
  }

  /** Where the walk is: an effect, a selection's eligibility, or a selection's effect. */
  private place: Place = "effect";

  condition(c: Node, file: string, record: string, pointer: string): Outcome {
    const override = this.overrides[this.key(file, record, pointer)];
    if (override !== undefined) return { node: override as Node };
    if (typeof c.operator === "string") {
      let ops = (c.operands ?? []) as Node[];
      // "The target is friendly" named the unit an aura is applied to, as do its keyword siblings.
      const recipientAnd = c.operator === "and" && ops.some((o) => o.type === "disposition-matches" && ((o.parameters ?? {}) as Node).subject === "target");
      if (recipientAnd)
        ops = ops.map((o) => (o.type === "disposition-matches" || (o.type === "target-has-keyword" && !o.negated) ? { ...o, parameters: { ...((o.parameters ?? {}) as Node), subject: "recipient" } } : o));
      // not(target-has-keyword X) was the aura voice: X is tested on the unit the effect is applied to.
      if (c.operator === "not" && ops.length === 1 && ops[0]!.type === "target-has-keyword" && !ops[0]!.negated)
        ops = [{ ...ops[0]!, parameters: { ...((ops[0]!.parameters ?? {}) as Node), subject: "recipient" } }];
      const out: Node[] = [];
      for (let i = 0; i < ops.length; i++) {
        const r = this.condition(ops[i]!, file, record, `${pointer}/operands/${i}`);
        if ("review" in r) return r;
        out.push(r.node);
      }
      if (c.operator === "not" && out.length > 1) return { node: { operator: "not", operands: [{ operator: "and", operands: out }] } };
      // Alternatives that are each one keyword on the same unit are one any_of.
      const single = (n: Node): [unknown, string] | null => {
        const p = (n.parameters ?? {}) as Node;
        return n.type === "has-keyword" && Array.isArray(p.all_of) && p.all_of.length === 1 && Object.keys(p).every((k) => k === "all_of" || k === "subject") ? [p.subject, String(p.all_of[0])] : null;
      };
      const singles = out.map(single);
      if (c.operator === "or" && out.length > 1 && singles.every((x) => x && x[0] === singles[0]![0]))
        return { node: { type: "has-keyword", parameters: { ...(singles[0]![0] !== undefined ? { subject: singles[0]![0] } : {}), any_of: singles.map((x) => x![1]) } } };
      return { node: { operator: c.operator, operands: out } };
    }
    const t = String(c.type);
    if (!LEGACY_TYPES.has(t) || (NEW_TYPES.has(t) && !SHARED.has(t))) return { node: c };
    const r = migrateSimple(c, this.sets, this.place);
    if ("review" in r) this.reviews.push({ file, record, pointer, reason: r.review, node: c });
    return r;
  }

  trigger(t: Node, file: string, record: string, pointer: string): Outcome {
    const override = this.overrides[this.key(file, record, pointer)];
    if (override !== undefined) return { node: override as Node };
    if (NEW_EVENTS.has(String(t.event))) return { node: t };
    const r = migrateTrigger(t, (c) => this.condition(c, file, record, `${pointer}/condition`));
    if ("review" in r && !this.reviews.some((x) => x.pointer.startsWith(`${pointer}/condition`) && x.record === record && x.file === file))
      this.reviews.push({ file, record, pointer, reason: r.review, node: t });
    return r;
  }

  /** Walk a record; collect replacements for every migrated slot. */
  walk(v: unknown, at: Array<string | number>, file: string, record: string, out: Replacement[]): void {
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        const p = [...at, i];
        // A step or option is an effect slot of its own.
        if (x && typeof x === "object" && !Array.isArray(x) && typeof (x as Node).type === "string" && this.isLegacyEffect(x as Node)) {
          const pointer = p.slice(this.base).join("/");
          const whole = this.overrides[this.key(file, record, pointer)];
          const r = whole !== undefined ? { node: whole as Node } : this.effect(x as Node, file, record, pointer);
          if (!("review" in r)) {
            if (JSON.stringify(r.node) !== JSON.stringify(x)) out.push({ path: p, value: r.node });
            return;
          }
        }
        this.walk(x, p, file, record, out);
      });
      return;
    }
    if (typeof v !== "object" || v === null) return;
    const outer = this.place;
    const outerWithin = this.effectCtx.within;
    const selecting = ["select-units", "for-each-unit", "designate-target"].includes(String((v as Node).type));
    for (const [k, child] of Object.entries(v as Node)) {
      if (k === "output" && file.startsWith("crates/wh40kdc/tests/fixtures/")) continue;
      const p = [...at, k];
      const pointer = p.slice(this.base).join("/");
      this.place = k === "eligibility" || k === "observer_eligibility" ? "eligibility" : selecting && k === "effect" ? "selection" : outer;
      this.effectCtx.within = selecting && k === "effect" ? "selection" : (v as Node).type === "aura" && k === "modifier" ? "aura" : outerWithin;
      // A hand override at any pointer replaces the whole value (a stale conditional's own effect).
      const whole = this.overrides[this.key(file, record, pointer)];
      if (whole !== undefined && !CONDITION_SLOTS.has(k) && !TRIGGER_SLOTS.has(k)) {
        if (JSON.stringify(whole) !== JSON.stringify(child)) out.push({ path: p, value: whole });
        continue;
      }
      if (k === "canonical_condition_ids" && Array.isArray(child) && child.includes("timing-is")) {
        out.push({ path: p, value: ["controls"] });
        continue;
      }
      if (TRIGGER_SLOTS.has(k) && (isTrigger(child) || (Array.isArray(child) && child.length > 0 && child.every(isTrigger)))) {
        const list = Array.isArray(child) ? child : [child];
        const done: Node[] = [];
        let ok = true;
        list.forEach((t, i) => {
          const r = this.trigger(t as Node, file, record, Array.isArray(child) ? `${pointer}/${i}` : pointer);
          if ("review" in r) ok = false;
          else done.push(r.node);
        });
        const value = Array.isArray(child) ? done : done[0];
        if (ok && JSON.stringify(value) !== JSON.stringify(child)) out.push({ path: p, value });
        continue;
      }
      if (k === "scope" && child && typeof child === "object" && !Array.isArray(child) && ("range" in (child as Node) || "range_inches" in (child as Node))) {
        this.reviews.push({ file, record, pointer, reason: "scope reach requires explicit recipient lowering before removal", node: child });
        continue;
      }
      if (child && typeof child === "object" && !Array.isArray(child) && typeof (child as Node).type === "string" && !CONDITION_SLOTS.has(k) && this.isLegacyEffect(child as Node)) {
        const r = this.effect(child as Node, file, record, pointer);
        if (!("review" in r)) {
          if (JSON.stringify(r.node) !== JSON.stringify(child)) out.push({ path: p, value: r.node });
          continue;
        }
      }
      if (CONDITION_SLOTS.has(k) && Array.isArray(child) && child.length > 0 && child.every(isCondition) && !child.every(isTrigger)) {
        const done: Node[] = [];
        let ok = true;
        (child as Node[]).forEach((c, i) => {
          const r = this.condition(c, file, record, `${pointer}/${i}`);
          if ("review" in r) ok = false;
          else done.push(r.node);
        });
        if (ok && JSON.stringify(done) !== JSON.stringify(child)) out.push({ path: p, value: done });
        continue;
      }
      if (CONDITION_SLOTS.has(k) && isCondition(child)) {
        const r = this.condition(child, file, record, pointer);
        if (!("review" in r) && JSON.stringify(r.node) !== JSON.stringify(child)) out.push({ path: p, value: r.node });
        if (!("review" in r)) continue;
      }
      this.walk(child, p, file, record, out);
    }
    this.place = outer;
    this.effectCtx.within = outerWithin;
  }

  file(abs: string): StagedWrite & { originalText: string } {
    const rel = path.relative(REPO, abs);
    const faction = factionOfDataFile(rel);
    const text = fs.readFileSync(abs, "utf8");
    const data = JSON.parse(text) as unknown;
    const reps: Replacement[] = [];
    const records = Array.isArray(data) ? data : [data];
    this.base = Array.isArray(data) ? 1 : 0;
    records.forEach((rec, i) => {
      const r = rec as Node;
      const id = String(r?.ability_id ?? r?.id ?? r?.source_id ?? i);
      const scope = (r?.scope ?? {}) as Node;
      this.effectCtx = { scopeRange: scope.range as string | undefined, rangeInches: scope.range_inches as number | undefined, abilityType: r?.ability_type as string | undefined, ruleText: faction ? this.ruleText.get(`${faction}/${id}`) : undefined };
      this.walk(rec, Array.isArray(data) ? [i] : [], rel, id, reps);
    });
    if (!reps.length) return { path: abs, value: data, text, originalText: text };
    if (process.argv.includes("--list")) for (const r of reps) console.log(`  ${rel} ${r.path.join("/")}`);
    // A file kept in the compact house style is rewritten in it; any other file is spliced.
    const compact = formatCompact(data) === text;
    const next = compact ? formatCompact(JSON.parse(applyReplacements(text, reps))) : applyReplacements(text, reps);
    JSON.parse(next);
    this.changed += reps.length;
    return { path: abs, value: JSON.parse(next) as unknown, text: next, originalText: text };
  }
}

/** The faction dir of a `data/{core,enrichment}/<faction>/…` file; undefined for any other file. */
export function factionOfDataFile(rel: string): string | undefined {
  return /^data\/(?:core|enrichment)\/([^/]+)\//.exec(rel.split(path.sep).join("/"))?.[1];
}

/** Rule text by `<faction>/<ability_id>` from the private MFM dump (never written anywhere); empty without the dump. */
export function dumpRuleText(repo: RepoProse | null = fs.existsSync(DEFAULT_DUMP_PATH) ? loadRepoProse() : null): Map<string, string> {
  const out = new Map<string, string>();
  if (!repo) return out;
  for (const [faction, byId] of Object.entries(repo.index())) {
    for (const [id, entry] of Object.entries(byId)) {
      const text = storeSource(entry as unknown as Record<string, unknown>);
      if (text) out.set(`${faction}/${id}`, text);
    }
  }
  return out;
}

function dataFiles(roots: string[], includeRegistry = false): string[] {
  const out: string[] = [];
  const skip = /(^|\/)(_audit|_reports|node_modules)(\/|$)/;
  const walk = (p: string): void => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e));
    else if (p.endsWith(".json") && !skip.test(path.relative(REPO, p)) && (includeRegistry || path.basename(p) !== "share-registry.json")) out.push(p);
  };
  for (const r of roots) walk(path.resolve(REPO, r));
  return out;
}

export interface MigrationOptions {
  dataRoot?: string;
  overrides?: Record<string, unknown>;
  sets?: KeywordSets;
  ruleText?: ReadonlyMap<string, string>;
}

/** Stage every input once; no source file is written by this API. */
export async function stageVocabulary(files: readonly string[], options: MigrationOptions = {}): Promise<VocabularyProjection> {
  const dataRoot = path.resolve(options.dataRoot ?? path.join(REPO, "data"));
  // Historical overrides were authored against earlier bytes; never replay them
  // implicitly over records that may have since been compiled or reviewed.
  const migrator = new Migrator(options.sets ?? await keywordSets(), options.overrides ?? {}, options.ruleText ?? new Map());
  const inputs = files.map((file) => migrator.file(path.resolve(file)));
  return projectVocabulary(inputs, dataRoot, migrator.reviews);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const valueFlags = ["--review", "--projection", "--staging-root", "--data-root"];
  for (const flag of valueFlags) {
    const index = argv.indexOf(flag);
    if (index >= 0 && (!argv[index + 1] || argv[index + 1]!.startsWith("--"))) throw new Error(`${flag} requires a value`);
  }
  const argument = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index < 0 ? undefined : argv[index + 1];
  };
  const dataRoot = path.resolve(argument("--data-root") ?? path.join(REPO, "data"));
  const roots = argv.filter((arg, i) => !arg.startsWith("--") && !valueFlags.includes(argv[i - 1] ?? ""));
  const files = dataFiles(roots.length ? roots : [dataRoot]);
  const projection = await stageVocabulary(files, { dataRoot, ruleText: dumpRuleText() });
  const stagingRoot = argument("--staging-root");
  if (stagingRoot) {
    const destination = path.resolve(fs.realpathSync(path.dirname(path.resolve(stagingRoot))), path.basename(stagingRoot));
    const relative = path.relative(fs.realpathSync(dataRoot), destination);
    if (!relative || !relative.startsWith(`..${path.sep}`)) throw new Error("Staging snapshot must be outside the data root.");
    if (fs.existsSync(destination)) throw new Error("Staging snapshot requires a new directory; existing bytes are never overwritten.");
    for (const source of projection.sources) {
      if (fs.readFileSync(source.path, "utf8") !== source.text) throw new Error(`Vocabulary input changed before snapshot: ${source.path}`);
    }
    fs.mkdirSync(destination);
    const staged = new Map(projection.staged.map((item) => [item.path, item]));
    for (const file of dataFiles([dataRoot], true)) {
      const output = path.join(destination, path.relative(dataRoot, file));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, staged.get(file)?.text ?? fs.readFileSync(file, "utf8"));
    }
    console.log(`Canonical inspection snapshot: ${destination} (not validated for publication).`);
  }
  let validationError: string | undefined;
  try {
    // Review diagnostics do not conceal schema/integrity failures in the projection.
    // This prepared handle is intentionally discarded: this is inspection only.
    // A no-op is still a complete dataset audit, without scheduling unchanged writes.
    const hasDataInputs = projection.sources.some((source) => {
      const relative = path.relative(dataRoot, source.path);
      return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (hasDataInputs) {
      await prepareWrites(projection.staged, { label: "vocabulary-dry-run", dataRoot, maxDiagnosticsPerRecord: 12, validateUnchanged: true });
    }
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }
  const reviewOut = argument("--review");
  const projectionOut = argument("--projection");
  if (reviewOut) fs.writeFileSync(path.resolve(reviewOut), JSON.stringify(projection.reviews, null, 2) + "\n");
  if (projectionOut) fs.writeFileSync(path.resolve(projectionOut), JSON.stringify({ ...projection, validationError }, null, 2) + "\n");
  console.log(`${projection.staged.length} data file(s), ${projection.fixtures.length} fixture file(s) projected; ${projection.reviews.length} node(s) need review.`);
  if (validationError) console.error(projectionOut ? `${validationError.split("\n", 1)[0]}\nBounded per-record validation diagnostics: ${projectionOut}` : validationError);
  if (projection.reviews.length || projection.fixtures.length || validationError) {
    process.exitCode = 1;
    return;
  }
  if (argv.includes("--write")) {
    const prepared = await prepareVocabulary(projection, dataRoot);
    prepared.commit();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();
