import * as fs from "node:fs";
import * as path from "node:path";
import { globSync } from "glob";
import { formatCompact } from "../compact-json.js";
import { prepareWrites, type PreparedWrites, type StagedWrite } from "../mfm/apply.js";
import { applyReplacements, type Replacement } from "./json-spans.js";
import { StanceIndex, type StanceRecord } from "./vocab-cutover-stance.js";
import { transformTiming } from "./vocab-cutover-timing.js";
import { transformFilters } from "./vocab-cutover-filters.js";
import { transformEffects } from "./vocab-cutover-effects.js";
import { transformGrantCategories } from "./vocab-cutover-grants.js";
import { migrateFixtureCall, renderFixture } from "./vocab-fixtures.js";
import { keywordIndex } from "../semantic-authoring/core-keywords.js";
import type { CutoverContext, Node } from "./vocab-cutover-types.js";
import type { Review } from "./migrate-vocabulary.js";

export interface VocabularyProjection {
  staged: StagedWrite[];
  fixtures: StagedWrite[];
  reviews: Review[];
  sources: Array<{ path: string; text: string }>;
}
const object = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);

/** Canonical cutover; fixture projection and production persistence stay separate. */
export function projectVocabulary(inputs: readonly (StagedWrite & { originalText?: string })[], dataRoot: string, initialReviews: readonly Review[] = []): VocabularyProjection {
  const reviews = [...initialReviews];
  const sources = inputs.map((input) => ({ path: input.path, text: input.originalText ?? fs.readFileSync(input.path, "utf8") }));
  const records: StanceRecord[] = [];
  const root = path.resolve(dataRoot);
  const unitKeywords = keywordIndex(root);
  const describe = (file: string): { file: string; faction?: string } => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const outside = relative === ".." || relative.startsWith("../");
    return { file: outside ? path.relative(path.dirname(root), file).split(path.sep).join("/") : `data/${relative}`, faction: /^(?:core|enrichment)\/([^/]+)\//.exec(relative)?.[1] };
  };
  // Index unchanged owner/core abilities as read dependencies, not migration targets.
  // Selected projections replace their on-disk counterparts; detached fixtures keep
  // their existing isolated reference context and never pull in the production tree.
  const selectedPaths = new Set(inputs.map((input) => path.resolve(input.path)));
  const factions = new Set(inputs.flatMap((input) => {
    const info = describe(input.path);
    return info.file.startsWith("data/") && info.faction ? [info.faction, "_core"] : [];
  }));
  for (const file of globSync("enrichment/*/abilities*.json", { cwd: root, absolute: true }).sort()) {
    const info = describe(file);
    if (!info.faction || !factions.has(info.faction) || selectedPaths.has(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    sources.push({ path: file, text });
    const value: unknown = JSON.parse(text);
    for (const [i, row] of (Array.isArray(value) ? value : [value]).entries()) {
      if (object(row)) records.push({ ...info, record: String(row.ability_id ?? row.id ?? row.source_id ?? i), value: row });
    }
  }
  for (const input of inputs) {
    const info = describe(input.path);
    for (const [i, value] of (Array.isArray(input.value) ? input.value : [input.value]).entries()) {
      if (object(value)) records.push({ ...info, record: String(value.ability_id ?? value.id ?? value.source_id ?? i), value });
    }
  }
  const stances = new StanceIndex(records);
  const staged: StagedWrite[] = [];
  const fixtures: StagedWrite[] = [];
  for (const input of inputs) {
    const info = describe(input.path);
    const isResolverFixture = path.basename(path.dirname(input.path)) === "abilities-resolver" &&
      ["from-dsl.json", "defensive-from-dsl.json"].includes(path.basename(input.path));
    const isFixture = !info.file.startsWith("data/") && (isResolverFixture ||
      ["condition-trigger-phrases.json", "phase4-shapes.json", "phase4-cruncher.json"].includes(path.basename(input.path)));
    const source = input.text ?? `${JSON.stringify(input.value, null, 2)}\n`;
    const value = structuredClone(input.value) as unknown;
    const replacements: Replacement[] = [];
    const rows = Array.isArray(value) ? value : [value];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!object(row)) continue;
      if (isFixture) migrateFixtureCall(row, input.path);
      const record = String(row.ability_id ?? row.id ?? row.source_id ?? i);
      if (object(row.scope) && Array.isArray(row.scope.applies_to)) {
        row.effect = { type: "conditional", condition: { type: "matches", parameters: { subject: "this-unit", filter: { all_of: row.scope.applies_to } } }, effect: row.effect };
        delete row.scope.applies_to;
      }
      if (object(row.scope)) {
        for (const field of ["aura_range_inches", "distance"]) {
          if (typeof row.scope[field] !== "number") continue;
          const reach = row.scope[field];
          const recipients: Node[] = [];
          const collect = (node: unknown): void => {
            if (Array.isArray(node)) node.forEach(collect);
            else if (object(node)) {
              if ("target" in node) recipients.push(node);
              Object.entries(node).forEach(([key, child]) => { if (key !== "target" && key !== "condition") collect(child); });
            }
          };
          collect(row.effect);
          if (recipients.length && recipients.every((node) => object(node.target) && object(node.target.within) && object(node.target.within.range) && node.target.within.range.inches === reach)) delete row.scope[field];
          else reviews.push({ ...info, record, pointer: `/scope/${field}`, reason: "scope reach is not duplicated by every effect recipient", node: reach });
        }
      }
      let selection = row.effect;
      while (object(selection) && selection.type === "conditional") selection = selection.effect;
      if (object(selection) && selection.type === "stance-select" && selection.select === "command-phase" && row.trigger === undefined) row.behavior = "activated";
      const walk = (child: unknown, pointer: string, parentKey?: string, parentType?: string): unknown => {
        if (Array.isArray(child)) return child.map((item, index) => walk(item, `${pointer}/${index}`, parentKey, parentType));
        if (!object(child)) return child;
        const ctx: CutoverContext = { ...info, record, pointer, parentKey, parentType, unitKeywords, report(reason, node, at = pointer) { reviews.push({ ...info, record, pointer: at, reason, node: structuredClone(node) as unknown }); } };
        // Detached phrase fixtures have no owning faction/ability reference scope.
        let next = isFixture && child.type === "rule-active" ? child : stances.transform(child, ctx);
        next = transformTiming(next, ctx);
        next = transformGrantCategories(next, ctx);
        next = transformFilters(next, ctx);
        next = transformEffects(next, ctx);
        for (const [key, item] of Object.entries(next)) {
          if (isFixture && key === "output") continue;
          next[key] = walk(item, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, key, typeof next.type === "string" ? next.type : undefined);
        }
        return next;
      };
      if (isResolverFixture) {
        // Resolver corpora carry frozen DSL only in `effect`; expected buff
        // projections are generated by the public resolver boundary and must
        // never be treated as DSL input during vocabulary migration.
        const cases = row.cases;
        if (Array.isArray(cases)) {
          cases.forEach((candidate, index) => {
            if (object(candidate) && "effect" in candidate)
              candidate.effect = walk(candidate.effect, `/cases/${index}/effect`);
          });
        }
        rows[i] = row;
        if (JSON.stringify(row) !== JSON.stringify((Array.isArray(input.value) ? input.value : [input.value])[i]))
          replacements.push({ path: Array.isArray(value) ? [i] : [], value: row });
        continue;
      }
      const migrated = walk(row, "");
      rows[i] = migrated;
      if (JSON.stringify(migrated) !== JSON.stringify((Array.isArray(input.value) ? input.value : [input.value])[i])) replacements.push({ path: Array.isArray(value) ? [i] : [], value: migrated });
    }
    // Catalog identities are part of this same projected dataset, never a separate write.
    if (info.file === "data/core/weapon-keywords.json" && Array.isArray(value)) {
      const catalog = value as Node[];
      const blast = catalog.find((entry) => entry.id === "blast");
      if (blast) {
        const optional = Array.isArray(blast.optional_parameters) ? blast.optional_parameters : [];
        if (!optional.includes("value")) blast.optional_parameters = [...optional, "value"];
      }
      if (!catalog.some((entry) => entry.id === "supa-hazardous")) {
        const version = catalog.find((entry) => object(entry.game_version))?.game_version;
        if (!version) reviews.push({ ...info, record: "supa-hazardous", pointer: "", reason: "catalog has no game-version context", node: null });
        else catalog.push({ id: "supa-hazardous", name: "Supa-Hazardous", required_parameters: [], effect: null, game_version: structuredClone(version) as unknown });
      }
      replacements.length = 0;
      if (JSON.stringify(value) !== JSON.stringify(input.value)) replacements.push({ path: [], value });
    }
    if (isFixture && !isResolverFixture) {
      renderFixture(value, input.path);
      replacements.length = 0;
      if (JSON.stringify(value) !== JSON.stringify(input.value)) replacements.push({ path: [], value });
    }
    const projected = replacements.length ? applyReplacements(source, replacements) : source;
    const parsed = JSON.parse(projected) as unknown;
    const text = formatCompact(input.value) === source ? formatCompact(parsed) : projected;
    if (text === sources.find((source) => source.path === input.path)!.text) continue;
    const write = { path: input.path, value: parsed, text };
    const relative = path.relative(root, input.path);
    (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative) ? fixtures : staged).push(write);
  }
  return { staged, fixtures, reviews, sources };
}

/** All files validate together; even one unresolved semantic binding prohibits persistence. */
export async function prepareVocabulary(projection: VocabularyProjection, dataRoot: string): Promise<PreparedWrites> {
  if (projection.reviews.length) throw new Error(`Vocabulary migration needs review at ${projection.reviews.map((review) => `${review.file}#${review.record}#${review.pointer}: ${review.reason}`).join("\n")}`);
  if (projection.fixtures.length) throw new Error("Fixture projections are review artifacts only; production persistence never writes outside the data root.");
  for (const source of projection.sources) {
    if (fs.readFileSync(source.path, "utf8") !== source.text) throw new Error(`Vocabulary input changed after projection: ${source.path}. Nothing was written.`);
  }
  const prepared = await prepareWrites(projection.staged, { label: "vocabulary", dataRoot, maxDiagnosticsPerRecord: 12, validateUnchanged: true });
  for (const source of projection.sources) {
    if (fs.readFileSync(source.path, "utf8") !== source.text) throw new Error(`Vocabulary input changed during preparation: ${source.path}. Nothing was written.`);
  }
  return prepared;
}
