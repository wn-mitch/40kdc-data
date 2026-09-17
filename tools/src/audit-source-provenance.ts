/**
 * Source-provenance audit.
 *
 * The harness reads a rule's operative text from the MFM dump when it can
 * resolve the rule there, and falls back to the faction's raw-text store
 * otherwise. The dump path resolves by name, and ability names collide across
 * factions ("Full Throttle" exists for both Orks and Adeptus Astartes), so a
 * resolution bug silently feeds the harness another faction's rule text —
 * which every downstream claim about that ability then rests on.
 *
 * This audit compares, per ability, the operative text the harness used
 * against the faction's own raw store and reports material divergence.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDump } from "./mfm/loader.js";
import { nameToId } from "./converters/id-generator.js";
import { buildCohortStates, slugCandidates } from "./jev-orks-experiment.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const PRIVATE_ROOT = join(REPO, "_private", "jev-orks");
const ORK_ABILITIES = join(REPO, "data", "enrichment", "orks", "abilities.json");

type AnyRecord = Record<string, unknown>;

/**
 * Collapse whitespace, punctuation spacing, and typographic variants, so only
 * real wording differences remain. The raw store writes "destroyed ," where the
 * dump writes "destroyed,"; that is a transcription artifact, not a divergence.
 *
 * The raw store also appends the rule's `Lore` paragraph, which the harness
 * deliberately drops, so that tail is removed before comparing.
 */
export function normalizeForCompare(text: string): string {
  const withoutLore = text.split(/\s+Lore\s+/)[0];
  return withoutLore
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([,.;:!?])(?=[A-Za-z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type ProvenanceFinding = {
  ability_id: string;
  name: string;
  kind: string;
  harness_text: string;
  raw_store_text: string;
  /** Raw store text matched some other faction's entry verbatim. */
  foreign_faction_match: string | null;
};

export function auditSourceProvenance(): {
  findings: ProvenanceFinding[];
  summary: Record<string, unknown>;
} {
  const abilities = JSON.parse(readFileSync(ORK_ABILITIES, "utf8")) as AnyRecord[];
  const corpus = JSON.parse(
    readFileSync(join(PRIVATE_ROOT, "source-corpus.json"), "utf8"),
  ) as Record<string, Record<string, string>>;
  const orkRaw = corpus.orks ?? {};
  const otherFactionText = new Map<string, string>();
  for (const [faction, rules] of Object.entries(corpus)) {
    if (faction === "orks" || !rules || typeof rules !== "object") continue;
    for (const text of Object.values(rules)) {
      if (typeof text === "string" && text.length > 40) {
        otherFactionText.set(normalizeForCompare(text), faction);
      }
    }
  }

  const ids = abilities
    .map((ability) => String(ability.ability_id))
    .filter((id) => id in orkRaw);
  const states = buildCohortStates({ abilityIds: ids });

  const findings: ProvenanceFinding[] = [];
  for (const abilityId of ids) {
    const state = states[abilityId];
    const record = abilities.find((candidate) => String(candidate.ability_id) === abilityId)!;
    if (!state) continue;
    const harness = normalizeForCompare(state.source_text);
    const raw = normalizeForCompare(orkRaw[abilityId]);
    if (harness === raw) continue;
    findings.push({
      ability_id: abilityId,
      name: String(record.name),
      kind: String(record.ability_type ?? "unit"),
      harness_text: state.source_text.slice(0, 260),
      raw_store_text: orkRaw[abilityId].slice(0, 260),
      foreign_faction_match: otherFactionText.get(harness) ?? null,
    });
  }

  const foreign = findings.filter((finding) => finding.foreign_faction_match !== null);
  return {
    findings,
    summary: {
      checked: ids.length,
      divergent: findings.length,
      divergent_foreign_faction: foreign.length,
      divergent_by_kind: findings.reduce<Record<string, number>>((counts, finding) => {
        counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
        return counts;
      }, {}),
    },
  };
}

/**
 * Regression guard for the unscoped-name-match bug.
 *
 * Replicates the PRE-FIX resolution for every ability: walk each lookup table
 * in its original order and take the FIRST name-slug match, with no faction
 * gate, no detachment gate, and (for the stratagem and rule-container tables)
 * no ability-type gate. Then report what that selection would have returned
 * relative to the ability's own faction and detachment.
 *
 * `cross_faction` is the severe case — the harness would have been fed another
 * faction's rule text, and every downstream claim about that ability would
 * rest on it. Zero is the only acceptable result.
 */
export function simulatePreFixResolution(): {
  findings: Array<{
    ability_id: string;
    ability_type: string;
    resolved_via: string;
    resolved_name: string | null;
    resolved_faction: string | null;
    own_detachment: string | null;
    verdict: "cross_faction" | "cross_detachment" | "type_mismatch";
  }>;
  summary: Record<string, unknown>;
} {
  const abilities = JSON.parse(readFileSync(ORK_ABILITIES, "utf8")) as AnyRecord[];
  const dump = loadDump();
  const findings: Array<{
    ability_id: string;
    ability_type: string;
    resolved_via: string;
    resolved_name: string | null;
    resolved_faction: string | null;
    own_detachment: string | null;
    verdict: "cross_faction" | "cross_detachment" | "type_mismatch";
  }> = [];

  for (const ability of abilities) {
    const abilityId = String(ability.ability_id);
    const abilityType = String(ability.ability_type);
    const ownDetachmentId = typeof ability.detachment_id === "string" ? ability.detachment_id : null;
    const ownDetachment = ownDetachmentId ? dump.byId("detachment").get(ownDetachmentId) : undefined;
    const unitIds = new Set(Array.isArray(ability.unit_ids) ? ability.unit_ids.map(String) : []);
    // A detachment-less ability still has a faction: take it from the ability's
    // own units' datasheets, exactly as the harness does. Without this the
    // cross-faction check silently no-ops for most abilities.
    const ownFaction = (ownDetachment ? dump.factionKeywordOfDetachment(ownDetachment.id) : null)
      ?? dump.table("datasheet")
        .filter((datasheet) => {
          const name = dump.enName(datasheet);
          return Boolean(name) && unitIds.has(nameToId(name!));
        })
        .map((datasheet) => dump.factionKeywordOfDatasheet(datasheet.id))
        .find((keyword): keyword is string => Boolean(keyword))
      ?? null;
    const ownDetachmentName = dump.enName(ownDetachment) ?? null;
    const ids = new Set(slugCandidates(String(ability.name), dump.enName(ownDetachment)));
    ids.add(abilityId);
    const matches = (name: string | undefined, detachmentName: string | undefined): boolean =>
      Boolean(name) && slugCandidates(name!, detachmentName).some((id) => ids.has(id));

    // Pass 1 — stratagem table (pre-fix: every ability type, no gates).
    const stratagem = dump.table("stratagem").find((row) =>
      matches(dump.enName(row), dump.enName(row.detachmentId
        ? dump.byId("detachment").get(row.detachmentId)
        : undefined)));
    if (stratagem) {
      const detachment = stratagem.detachmentId
        ? dump.byId("detachment").get(stratagem.detachmentId)
        : undefined;
      const resolvedFaction = stratagem.detachmentId
        ? dump.factionKeywordOfDetachment(stratagem.detachmentId)
        : null;
      const crossFaction = Boolean(ownFaction && resolvedFaction && ownFaction !== resolvedFaction);
      const crossDetachment = Boolean(ownDetachment && stratagem.detachmentId
        && stratagem.detachmentId !== ownDetachment.id);
      if (abilityType !== "stratagem" || crossFaction || crossDetachment) {
        findings.push({
          ability_id: abilityId,
          ability_type: abilityType,
          resolved_via: "stratagem",
          resolved_name: dump.enName(stratagem) ?? null,
          resolved_faction: resolvedFaction,
          own_detachment: ownDetachmentName,
          verdict: crossFaction ? "cross_faction" : crossDetachment ? "cross_detachment" : "type_mismatch",
        });
      }
      continue;
    }

    // Pass 3 — rule containers (pre-fix: every ability type, no gates).
    const groups = [
      { table: "detachment_rule" as const, expectedType: "detachment" },
      { table: "army_rule" as const, expectedType: "faction" },
    ];
    let resolved = false;
    for (const group of groups) {
      const rule = dump.table(group.table).find((row) => {
        const detachment = "detachmentId" in row && typeof row.detachmentId === "string"
          ? dump.byId("detachment").get(row.detachmentId)
          : undefined;
        return matches(dump.enName(row), dump.enName(detachment));
      });
      if (!rule) continue;
      const detachment = "detachmentId" in rule && typeof rule.detachmentId === "string"
        ? dump.byId("detachment").get(rule.detachmentId)
        : undefined;
      const resolvedFaction = detachment ? dump.factionKeywordOfDetachment(detachment.id) : null;
      const crossFaction = Boolean(ownFaction && resolvedFaction && ownFaction !== resolvedFaction);
      const crossDetachment = Boolean(ownDetachment && detachment && detachment.id !== ownDetachment.id);
      if (abilityType !== group.expectedType || crossFaction || crossDetachment) {
        findings.push({
          ability_id: abilityId,
          ability_type: abilityType,
          resolved_via: group.table,
          resolved_name: dump.enName(rule) ?? null,
          resolved_faction: resolvedFaction,
          own_detachment: ownDetachmentName,
          verdict: crossFaction ? "cross_faction" : crossDetachment ? "cross_detachment" : "type_mismatch",
        });
      }
      resolved = true;
      break;
    }
    if (resolved) continue;
  }

  return {
    findings,
    summary: {
      abilities: abilities.length,
      pre_fix_misresolved: findings.length,
      cross_faction: findings.filter((finding) => finding.verdict === "cross_faction").length,
      cross_detachment: findings.filter((finding) => finding.verdict === "cross_detachment").length,
      type_mismatch: findings.filter((finding) => finding.verdict === "type_mismatch").length,
    },
  };
}

const isMain = process.argv[1]?.endsWith("audit-source-provenance.ts") ?? false;
if (isMain) {
  const report = auditSourceProvenance();
  const simulation = simulatePreFixResolution();
  console.log(JSON.stringify({ provenance: report.summary, pre_fix_simulation: simulation.summary }, null, 2));
  if (simulation.findings.length) {
    console.log("\npre-fix mis-resolutions (first match wins, unscoped):");
    for (const finding of simulation.findings) {
      console.log(`  ${finding.ability_id}  [${finding.verdict}]  own=${finding.own_detachment}`
        + `  resolved=${finding.resolved_name} (${finding.resolved_faction})`);
    }
  }
  console.log("\nprovenance divergences:");
  const ordered = [...report.findings].sort((left, right) =>
    Number(right.foreign_faction_match !== null) - Number(left.foreign_faction_match !== null));
  for (const finding of ordered) {
    console.log(`\n  ${finding.ability_id}  (${finding.name})  kind=${finding.kind}`
      + (finding.foreign_faction_match ? `  ⟵ matches ${finding.foreign_faction_match}` : ""));
    console.log(`    harness  : ${finding.harness_text.replace(/\s+/g, " ").slice(0, 150)}`);
    console.log(`    raw store: ${finding.raw_store_text.replace(/\s+/g, " ").slice(0, 150)}`);
  }
  writeFileSync(
    join(PRIVATE_ROOT, "source-provenance.json"),
    JSON.stringify({ ...report, pre_fix_simulation: simulation }, null, 2),
  );
}
