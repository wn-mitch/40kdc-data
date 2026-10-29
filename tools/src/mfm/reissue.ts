/**
 * reissue.ts — carry repo detachments, stratagems and enhancements across a publication GW
 * reissued under new dump ids.
 *
 * A new codex reprints the rules it keeps as new dump rows: same printed name, new UUID. Every
 * pass that joins on the `mfm` external ref then finds the repo record's ref dead, and
 * `mfm:mirror` would remove the record as retired even though the game still has it. This pass
 * runs first and moves each dead ref to its reissued row, so later passes see the record as live
 * and only content the dump no longer prints is retired.
 *
 * A dead ref U moves to row R when R is the ONLY dump row that:
 *   - is in the same table (detachment / stratagem / enhancement);
 *   - prints the same name (compared as `nameToId` slugs, so case and punctuation drift match);
 *   - for a stratagem or enhancement, belongs to a detachment printing the same name as the
 *     repo record's detachment;
 *   - is owned by a faction dir that holds U, or by the parent roster of one (SM chapters
 *     replicate the Adeptus Astartes rows);
 *   - no repo record already references.
 * Several candidates are reported as ambiguous and nothing moves; none leaves the ref dead for
 * the mirror to retire. Every repo copy of U (the replicated chapter copies) moves together.
 *
 * IP: reads only ids and printed names. Edits are span-preserving.
 */
import * as fs from "fs";
import * as path from "path";

import { nameToId } from "../converters/id-generator.js";
import { applyReplacements, type Replacement } from "../round6/json-spans.js";
import type { StagedWrite } from "./apply.js";
import { repoDirForFactionName, SHARED_ROSTERS } from "./faction-map.js";
import type { MfmDump } from "./loader.js";
import { CORE_DIR } from "./repo-files.js";

export type ReissueKind = "detachment" | "stratagem" | "enhancement";
const FILES: Record<ReissueKind, string> = { detachment: "detachments.json", stratagem: "stratagems.json", enhancement: "enhancements.json" };
const KINDS = Object.keys(FILES) as ReissueKind[];

type Ref = { namespace?: string; id?: string };
type CoreRecord = { id: string; name?: string; detachment_id?: string | null; external_refs?: Ref[] };

export interface ReissueMove {
  kind: ReissueKind;
  name: string;
  detachment: string | null;
  from: string;
  to: string;
  dirs: string[];
}
export interface ReissueReport {
  moved: ReissueMove[];
  ambiguous: Array<Omit<ReissueMove, "to"> & { candidates: string[] }>;
  /** Dead refs with no reissued row: the content the dump retired. */
  retired: Array<Omit<ReissueMove, "to">>;
  staged: StagedWrite[];
}

const slug = (name: string | undefined): string | null => {
  if (!name) return null;
  try {
    return nameToId(name);
  } catch {
    return null;
  }
};

interface DumpCandidate {
  id: string;
  name: string;
  detachment: string | null;
  dir: string | null;
}

function dumpCandidates(dump: MfmDump, kind: ReissueKind): DumpCandidate[] {
  const detachments = dump.byId("detachment");
  const dirOf = (detachmentId: string | null | undefined): string | null => {
    if (!detachmentId) return null;
    const fk = dump.factionKeywordOfDetachment(detachmentId);
    return fk ? repoDirForFactionName(dump.enName(dump.byId("faction_keyword").get(fk))) : null;
  };
  const out: DumpCandidate[] = [];
  for (const row of dump.table(kind) as ReadonlyArray<{ id: string; detachmentId?: string | null }>) {
    const name = slug(dump.enName(row as never));
    if (!name) continue;
    const detachmentId = kind === "detachment" ? row.id : row.detachmentId;
    const detachment = kind === "detachment" ? null : slug(dump.enName(detachments.get(detachmentId ?? "") as never));
    if (kind !== "detachment" && !detachment) continue;
    out.push({ id: row.id, name, detachment, dir: dirOf(detachmentId) });
  }
  return out;
}

/** Plan and stage the ref moves for every faction dir under `coreDir`. */
export function runReissue(dump: MfmDump, coreDir: string = CORE_DIR): ReissueReport {
  const dirs = fs.readdirSync(coreDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const texts = new Map<string, string>();
  const records = new Map<string, CoreRecord[]>();
  for (const dir of dirs) {
    for (const kind of KINDS) {
      const file = path.join(coreDir, dir, FILES[kind]);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      texts.set(file, text);
      records.set(file, JSON.parse(text) as CoreRecord[]);
    }
  }
  const mfmIds = (r: CoreRecord) => (r.external_refs ?? []).filter((x) => x.namespace === "mfm" && x.id).map((x) => x.id!);
  const referenced = new Set([...records.values()].flat().flatMap(mfmIds));

  const report: ReissueReport = { moved: [], ambiguous: [], retired: [], staged: [] };
  const replacements = new Map<string, Replacement[]>();
  for (const kind of KINDS) {
    const live = new Set(dump.table(kind).map((r) => (r as { id: string }).id));
    const candidates = dumpCandidates(dump, kind);
    // Dead ref → the repo copies carrying it, with the names the move is matched on.
    const dead = new Map<string, { name: string; detachment: string | null; holders: Array<{ file: string; dir: string; index: number; ref: number }> }>();
    for (const dir of dirs) {
      const file = path.join(coreDir, dir, FILES[kind]);
      const recs = records.get(file);
      if (!recs) continue;
      const detachmentNames = new Map((records.get(path.join(coreDir, dir, FILES.detachment)) ?? []).map((d) => [d.id, slug(d.name)]));
      recs.forEach((record, index) => {
        const refs = record.external_refs ?? [];
        if (!refs.some((x) => x.namespace === "mfm" && x.id) || refs.some((x) => x.namespace === "mfm" && x.id && live.has(x.id))) return;
        refs.forEach((ref, refIndex) => {
          if (ref.namespace !== "mfm" || !ref.id) return;
          const entry = dead.get(ref.id) ?? {
            name: slug(record.name) ?? "",
            detachment: kind === "detachment" ? null : (detachmentNames.get(record.detachment_id ?? "") ?? slug(record.detachment_id ?? undefined) ?? null),
            holders: [],
          };
          entry.holders.push({ file, dir, index, ref: refIndex });
          dead.set(ref.id, entry);
        });
      });
    }
    for (const [from, entry] of [...dead.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const holderDirs = [...new Set(entry.holders.map((h) => h.dir))].sort();
      const owners = new Set(holderDirs.flatMap((d) => [d, ...(SHARED_ROSTERS[d] ?? [])]));
      const found = candidates.filter(
        (c) => c.name === entry.name && c.detachment === entry.detachment && c.dir !== null && owners.has(c.dir) && !referenced.has(c.id),
      );
      const base = { kind, name: entry.name, detachment: entry.detachment, from, dirs: holderDirs };
      if (found.length === 0) report.retired.push(base);
      else if (found.length > 1) report.ambiguous.push({ ...base, candidates: found.map((c) => c.id).sort() });
      else {
        const to = found[0].id;
        referenced.add(to);
        report.moved.push({ ...base, to });
        for (const h of entry.holders) {
          const list = replacements.get(h.file) ?? replacements.set(h.file, []).get(h.file)!;
          list.push({ path: [h.index, "external_refs", h.ref, "id"], value: to });
        }
      }
    }
  }
  for (const [file, list] of [...replacements.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const text = applyReplacements(texts.get(file)!, list);
    report.staged.push({ path: file, value: JSON.parse(text), text });
  }
  return report;
}

/** Markdown summary: printed names and ids only, never prose. */
export function buildReissueReport(report: ReissueReport, write: boolean): string {
  const line = (m: Omit<ReissueMove, "to"> & { to?: string }) =>
    `- ${m.kind} \`${m.name}\`${m.detachment ? ` (${m.detachment})` : ""}: \`${m.from}\`${m.to ? ` → \`${m.to}\`` : ""} in ${m.dirs.join(", ")}`;
  return [
    `# MFM reissued refs${write ? "" : " (dry run)"}`,
    "",
    "Dead `mfm` refs moved to the same-named row a reissued publication prints. Refs with no",
    "reissued row are the content the dump retired; `mfm:mirror` removes those records.",
    "",
    `- **Moved:** ${report.moved.length}`,
    `- **Ambiguous (not moved):** ${report.ambiguous.length}`,
    `- **Retired (no reissued row):** ${report.retired.length}`,
    "",
    "## Moved",
    "",
    ...report.moved.map(line),
    "",
    "## Ambiguous",
    "",
    ...report.ambiguous.map((a) => `${line(a)} — candidates ${a.candidates.map((c) => `\`${c}\``).join(", ")}`),
    "",
    "## Retired",
    "",
    ...report.retired.map(line),
    "",
  ].join("\n");
}
