/**
 * The mirror's dry-run report, written under `_private/` (it lists printed rule names, never
 * prose): counts, the (faction, old id) → new id map, removals with reasons, created stubs,
 * reference rewrites by file, unit ref repairs, collisions, validation, and everything the rules
 * could not decide.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { MirrorResult } from "./mirror.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const count = <T>(xs: readonly T[], key: (x: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])));
};

export interface ReportSummary {
  records: number;
  kept: number;
  renamed: number;
  merged: number;
  removed: Record<string, number>;
  moved: number;
  stubs: Record<string, number>;
  entities: Record<string, number>;
  unitsChanged: number;
  unitRefs: { added: number; dropped: Record<string, number> };
  phaseMappings: Record<string, number>;
  filesChanged: number;
  newFiles: string[];
  rewritesByKind: Record<string, number>;
  undecided: Record<string, number>;
  collisions: number;
  oneToMany: number;
  validation: string;
}

export function summarize(r: MirrorResult): ReportSummary {
  const recs = r.plan.records;
  return {
    records: recs.length,
    kept: recs.filter((d) => d.survivor).length,
    renamed: recs.filter((d) => d.survivor && d.newId !== d.oldId).length,
    merged: recs.filter((d) => d.reason === "merged").length,
    removed: count(recs.filter((d) => !d.newId), (d) => d.reason ?? "?"),
    moved: r.log.filter((l) => l.kind === "record-moved").length,
    stubs: count(r.plan.stubs, (s) => (s.faction === "_core" ? "_core" : s.namespace === "local" ? s.kinds.join("+") : s.namespace)),
    entities: count(r.plan.entities, (e) => `${e.kind}:${e.newId === null ? "removed" : e.newId === e.oldId ? "unchanged" : "renamed"}`),
    unitsChanged: r.log.filter((l) => l.kind === "unit-ability-ids").length,
    unitRefs: {
      added: r.plan.units.reduce((n, u) => n + u.added.length, 0),
      dropped: count(r.plan.units.flatMap((u) => u.dropped), (d) => d.reason),
    },
    phaseMappings: count(r.log.filter((l) => l.kind.startsWith("phase-mapping")), (l) => l.kind),
    filesChanged: r.files.length,
    newFiles: r.files.filter((f) => !f.exists).map((f) => f.rel),
    rewritesByKind: count(r.log, (l) => l.kind),
    undecided: count(r.undecided, (u) => u.kind),
    collisions: r.collisions.length,
    oneToMany: r.oneToMany.length,
    validation: r.validation ? (r.validation.ok ? "valid" : "FAILS") : "not run",
  };
}

export function writeReport(r: MirrorResult, outDir: string): ReportSummary {
  mkdirSync(outDir, { recursive: true });
  const w = (name: string, v: unknown): void => writeFileSync(path.join(outDir, name), typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);
  const s = summarize(r);
  w("summary.json", s);
  w(
    "id-map.json",
    r.plan.records
      .map((d) => ({ faction: d.dir, old_id: d.oldId, new_id: d.newId, survivor: d.survivor, ...(d.via ? { via: d.via } : {}), ...(d.reason ? { reason: d.reason } : {}), ...(d.detail ? { detail: d.detail } : {}) }))
      .sort((a, b) => cmp(a.faction, b.faction) || cmp(a.old_id, b.old_id)),
  );
  w("removals.json", {
    records: r.plan.records.filter((d) => !d.newId).map((d) => ({ faction: d.dir, id: d.oldId, reason: d.reason, detail: d.detail })),
    merged: r.plan.records.filter((d) => d.reason === "merged").map((d) => ({ faction: d.dir, id: d.oldId, into: d.newId, detail: d.detail })),
    entities: r.plan.entities.filter((e) => !e.newId).map((e) => ({ kind: e.kind, dir: e.dir, id: e.oldId, reason: e.reason })),
    phase_mappings: r.log.filter((l) => l.kind === "phase-mapping-dead" || l.kind === "phase-mapping-duplicate"),
  });
  w(
    "stubs.json",
    r.plan.stubs.map((i) => ({ id: i.id, faction: i.faction, namespace: i.namespace, kinds: i.kinds, name: i.name, ...(i.variant ? { variant: i.variant } : {}), dump_rows: i.rows.map((x) => x.ref) })),
  );
  const byFile: Record<string, Record<string, number>> = {};
  for (const l of r.log) (byFile[l.file] ??= {})[l.kind] = (byFile[l.file]![l.kind] ?? 0) + 1;
  w("rewrites-by-file.json", Object.fromEntries(Object.entries(byFile).sort((a, b) => cmp(a[0], b[0]))));
  w("rewrites.jsonl", r.log.map((l) => JSON.stringify(l)).join("\n") + "\n");
  w(
    "units.json",
    r.plan.units
      .filter((u) => u.added.length || u.dropped.length || u.note || Object.keys(u.ratings).length)
      .map((u) => ({ dir: u.dir, unit: u.unitId, added: u.added, dropped: u.dropped, ...(Object.keys(u.ratings).length ? { core_ratings: u.ratings } : {}), ...(u.note ? { note: u.note } : {}) })),
  );
  w("undecided.json", [...r.undecided].sort((a, b) => cmp(a.kind, b.kind) || cmp(a.where, b.where)));
  w("collisions.json", { collisions: r.collisions, one_to_many: r.oneToMany });
  w("files.json", r.files.map((f) => ({ file: f.rel, new: !f.exists, bytes_before: f.before.length, bytes_after: f.after.length })));
  w("validation.txt", r.validation ? `${r.validation.ok ? "VALID" : "FAILS"}\n\n${r.validation.message}\n` : "not run\n");
  w("summary.md", renderSummary(s));
  return s;
}

function renderSummary(s: ReportSummary): string {
  const kv = (o: Record<string, number>): string => Object.entries(o).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- none";
  return `# mfm:mirror dry run

Ability records: ${s.records}. Kept ${s.kept} (renamed ${s.renamed}, moved to another dir ${s.moved}); folded into another record ${s.merged}.

## Removed records
${kv(s.removed)}

## Stubs created
${kv(s.stubs)}

## Entities
${kv(s.entities)}

## Units
${s.unitsChanged} units change ability_ids; ${s.unitRefs.added} refs added; dropped:
${kv(s.unitRefs.dropped)}

## Phase mappings
${kv(s.phaseMappings)}

## Files
${s.filesChanged} files change; new files: ${s.newFiles.join(", ") || "none"}.

## Rewrites by kind
${kv(s.rewritesByKind)}

## Undecided (see undecided.json)
${kv(s.undecided)}

Collisions: ${s.collisions}. One-to-many renames: ${s.oneToMany}. Validation: ${s.validation} (validation.txt).
`;
}
