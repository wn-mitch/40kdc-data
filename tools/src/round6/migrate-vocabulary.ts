/**
 * migrate-vocabulary — move every condition and trigger in the data to the round-6 predicate
 * vocabulary and event families. Values are spliced into each file's own text, so only
 * migrated nodes change. A node the rules cannot place is listed for review and left alone
 * (the run then refuses --write) until `vocab-overrides.json` supplies its new form.
 * Nodes already in the new vocabulary are kept, so the tool can be re-run on data that
 * lands later in the old form.
 *
 * Usage: npx tsx tools/src/round6/migrate-vocabulary.ts [--write] [--review <out.json>] [paths…]
 */
import * as fs from "fs";
import * as path from "path";

import { buildReferenceVocabularies } from "../audit-dangling-refs.js";
import { formatCompact } from "../compact-json.js";
import { keywordIndex } from "../round5c/core-keywords.js";
import { applyReplacements, type Replacement } from "./json-spans.js";
import { LEGACY_TYPES, migrateSimple, type KeywordSets, type Place, type Node, type Outcome } from "./vocab-conditions.js";
import { migrateTrigger } from "./vocab-triggers.js";

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
const SHARED = new Set(["phase-is", "player-turn-is", "battle-round", "operation-markers", "engagement-fronts", "destroyed-while-on-objective", "destroyed-in-tagged-terrain", "terrain-area-control"]);

const CONDITION_SLOTS = new Set(["condition", "eligibility", "qualified_condition", "requires", "attack_condition", "observer_eligibility", "units", "completes", "restrictions", "when"]);
const TRIGGER_SLOTS = new Set(["trigger", "when"]);

export type Review = { file: string; record: string; pointer: string; reason: string; node: unknown };

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
  constructor(
    private sets: KeywordSets,
    private overrides: Record<string, unknown>,
  ) {}

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
    if ((NEW_TYPES.has(t) && !SHARED.has(t)) || (!NEW_TYPES.has(t) && !LEGACY_TYPES.has(t))) return { node: c };
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
      v.forEach((x, i) => this.walk(x, [...at, i], file, record, out));
      return;
    }
    if (typeof v !== "object" || v === null) return;
    const outer = this.place;
    const selecting = ["select-units", "for-each-unit", "designate-target"].includes(String((v as Node).type));
    for (const [k, child] of Object.entries(v as Node)) {
      const p = [...at, k];
      const pointer = p.slice(this.base).join("/");
      this.place = k === "eligibility" || k === "observer_eligibility" ? "eligibility" : selecting && k === "effect" ? "selection" : outer;
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
  }

  file(abs: string, write: boolean): void {
    const rel = path.relative(REPO, abs);
    const text = fs.readFileSync(abs, "utf8");
    const data = JSON.parse(text) as unknown;
    const reps: Replacement[] = [];
    const records = Array.isArray(data) ? data : [data];
    this.base = Array.isArray(data) ? 1 : 0;
    records.forEach((rec, i) => {
      const r = rec as Node;
      const id = String(r?.ability_id ?? r?.id ?? r?.source_id ?? i);
      this.walk(rec, Array.isArray(data) ? [i] : [], rel, id, reps);
    });
    if (!reps.length) return;
    if (process.argv.includes("--list")) for (const r of reps) console.log(`  ${rel} ${r.path.join("/")}`);
    // A file kept in the compact house style is rewritten in it; any other file is spliced.
    const compact = formatCompact(data) === text;
    const next = compact ? formatCompact(JSON.parse(applyReplacements(text, reps))) : applyReplacements(text, reps);
    JSON.parse(next);
    this.changed += reps.length;
    if (write) fs.writeFileSync(abs, next);
  }
}

function dataFiles(roots: string[]): string[] {
  const out: string[] = [];
  const skip = /(^|\/)(_audit|_reports|node_modules)(\/|$)|share-registry\.json$/;
  const walk = (p: string): void => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e));
    else if (p.endsWith(".json") && !skip.test(path.relative(REPO, p))) out.push(p);
  };
  for (const r of roots) walk(path.resolve(REPO, r));
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const reviewAt = argv.indexOf("--review");
  const reviewOut = reviewAt >= 0 ? argv[reviewAt + 1] : undefined;
  const roots = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--review");
  const overridesPath = path.join(path.dirname(new URL(import.meta.url).pathname), "vocab-overrides.json");
  const overrides = fs.existsSync(overridesPath) ? loadJson<Record<string, unknown>>(overridesPath) : {};
  const sets = await keywordSets();
  const m = new Migrator(sets, overrides);
  const files = dataFiles(roots.length ? roots : ["data", "tools/test/fixtures"]);
  // A dry pass first: --write only proceeds when nothing needs review.
  for (const f of files) m.file(f, false);
  const reasons = new Map<string, number>();
  for (const r of m.reviews) reasons.set(r.reason.replace(/"[^"]*"/g, '"…"'), (reasons.get(r.reason.replace(/"[^"]*"/g, '"…"')) ?? 0) + 1);
  console.log(`${m.changed} slot(s) migrate across ${files.length} files; ${m.reviews.length} node(s) need review.`);
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${reason}`);
  if (reviewOut) fs.writeFileSync(path.resolve(reviewOut), JSON.stringify(m.reviews, null, 2) + "\n");
  if (write) {
    if (m.reviews.length) {
      console.error("Refusing --write while nodes need review; add them to vocab-overrides.json.");
      process.exit(1);
    }
    const w = new Migrator(sets, overrides);
    for (const f of files) w.file(f, true);
    console.log(`Wrote ${w.changed} slot(s).`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();
