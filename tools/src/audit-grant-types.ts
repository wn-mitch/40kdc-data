/**
 * Audit of `ability-grant.modifier.grant_type` — the DSL's free-text escape hatch.
 *
 * An `ability-grant` whose payload is a `grant_type` string asserts a name and
 * nothing else. The schema constrains only the `rules_bundle` form, so
 * `grant_type` accepts any string, and nothing downstream can act on it:
 *
 *   - AJV passes, because the value is just a `string`.
 *   - `describeAbility` title-cases the kebab string and emits it as prose
 *     ("psychic-abilities" → "This model gains the Psychic Abilities ability"),
 *     so a prose round trip of such a record is true by construction.
 *   - No engine can consume "no-smoke".
 *
 * That makes a grant_type record unfalsifiable: there is no feature to extract,
 * so no fidelity metric over it can report anything but success. This tool
 * measures the size of that hole and clusters it into work: which strings name
 * an effect type that already exists, which are duplicates of each other, and
 * which are genuinely new.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const DATA_ROOT = join(REPO, "data");
const PRIVATE_ROOT = join(REPO, "_private", "jev-orks");
const EFFECT_SCHEMA = join(REPO, "schemas", "enrichment", "ability-dsl", "effect.schema.json");

type AnyRecord = Record<string, unknown>;

/** Tokens used for name comparison; the filler words carry no meaning. */
const NAME_STOP = new Set([
  "a", "an", "the", "to", "of", "in", "on", "per", "and", "or", "is", "as", "if",
  "this", "that", "model", "models", "unit", "units", "ability", "abilities",
]);

export function nameTokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase().split(/[-_\s]+/).filter((token) => token && !NAME_STOP.has(token)),
  );
}

export function jaccardTokens(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Every effect type the schema declares, for the "already exists" comparison. */
export function schemaEffectTypes(): string[] {
  const schema = JSON.parse(readFileSync(EFFECT_SCHEMA, "utf8")) as AnyRecord;
  const found: string[][] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as AnyRecord;
    if (Array.isArray(record.enum)) found.push(record.enum.map(String));
    Object.values(record).forEach(visit);
  };
  visit(schema);
  const candidates = found.filter((values) => values.includes("stat-modifier") || values.includes("mortal-wounds"));
  return candidates.sort((left, right) => right.length - left.length)[0] ?? [];
}

function walkEffect(node: unknown, visit: (node: AnyRecord) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walkEffect(child, visit));
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as AnyRecord;
  if (typeof record.type === "string") visit(record);
  Object.values(record).forEach((child) => walkEffect(child, visit));
}

async function enrichmentFiles(): Promise<string[]> {
  const matches: string[] = [];
  for await (const file of glob("enrichment/**/abilities.json", { cwd: DATA_ROOT })) {
    // `enrichment/_core/abilities.json` is production data shared by every
    // faction, so unlike the vocabulary-source scan there is no underscore
    // exclusion here. Excluding it silently dropped a real grant_type from the
    // vocabulary and broke validation for the record carrying it.
    matches.push(join(DATA_ROOT, file));
  }
  return matches.sort();
}

export type GrantTypeUse = {
  grant_type: string;
  uses: number;
  factions: string[];
  ability_ids: string[];
};

export type GrantTypeClassification = GrantTypeUse & {
  verdict:
    | "references-core-ability"
    | "names-existing-effect"
    | "duplicate"
    | "novel";
  /** Existing effect type the name matches exactly, if any. */
  matches_effect_type: string | null;
  /** Core ability catalog id this names, if any. */
  references_core_ability: string | null;
  /** Other grant types this one is near-identical to. */
  duplicates: string[];
};

export type GrantTypeAudit = {
  records: number;
  files: number;
  distinct_grant_types: number;
  total_uses: number;
  /** Records whose entire payload is one or more opaque grants. */
  opaque_grant_only_records: number;
  classifications: GrantTypeClassification[];
  summary: AnyRecord;
};

/**
 * The core ability catalog: datacard abilities that name a core rule
 * (`Stealth`, `Leader`, `Deep Strike`, `Scouts X"`) without reprinting it.
 * Naming one of these is legitimate — the semantics live in the core rules on
 * purpose — so these must not be treated as authoring debt.
 */
function coreAbilityCatalog(): Array<{ id: string; parameters: string[] }> {
  const path = join(DATA_ROOT, "core", "unit-keywords.json");
  const rows = JSON.parse(readFileSync(path, "utf8")) as AnyRecord[];
  return rows.map((row) => ({
    id: String(row.id),
    parameters: Array.isArray(row.required_parameters) ? row.required_parameters.map(String) : [],
  }));
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Match a grant type to a core ability, allowing a parameter suffix
 * (`scouts-6` → `scouts`, `deadly-demise-d6` → `deadly-demise`).
 */
function coreAbilityMatch(
  grantType: string,
  catalog: ReadonlyArray<{ id: string; parameters: string[] }>,
): string | null {
  const normalized = normalizeName(grantType);
  for (const entry of catalog) {
    if (normalizeName(entry.id) === normalized) return entry.id;
  }
  for (const entry of catalog) {
    const base = normalizeName(entry.id);
    if (base.length < 5 || !normalized.startsWith(base) || normalized === base) continue;
    const suffix = normalized.slice(base.length);
    if (/^[0-9dxplus]+$/.test(suffix)) return entry.id;
  }
  return null;
}

const DUPLICATE_THRESHOLD = 0.75;

export async function auditGrantTypes(): Promise<GrantTypeAudit> {
  const files = await enrichmentFiles();
  const effectTypes = schemaEffectTypes();
  const effectTypeSet = new Set(effectTypes);
  const coreCatalog = coreAbilityCatalog();

  const uses = new Map<string, GrantTypeUse>();
  let records = 0;
  let opaqueOnly = 0;

  for (const file of files) {
    const faction = relative(DATA_ROOT, file).split(sep)[1];
    const abilities = JSON.parse(readFileSync(file, "utf8")) as AnyRecord[];
    for (const ability of abilities) {
      records += 1;
      const nodes: AnyRecord[] = [];
      walkEffect(ability.effect, (node) => nodes.push(node));
      const grants = nodes.filter((node) => node.type === "ability-grant");
      const grantTypes = grants
        .map((node) => (node.modifier as AnyRecord | undefined)?.grant_type)
        .filter((value): value is string => typeof value === "string");
      if (grantTypes.length === 0) continue;

      // Opaque = every grant is a bare name, and no other node carries a
      // parameter. Such a record states a label and no mechanic.
      const substantiveOtherNode = nodes.some((node) => {
        if (node.type === "ability-grant") return false;
        const modifier = node.modifier;
        return modifier !== null && typeof modifier === "object"
          && Object.keys(modifier as AnyRecord).length > 0;
      });
      if (!substantiveOtherNode && grantTypes.length > 0) opaqueOnly += 1;

      for (const grantType of grantTypes) {
        const existing = uses.get(grantType) ?? {
          grant_type: grantType,
          uses: 0,
          factions: [],
          ability_ids: [],
        };
        existing.uses += 1;
        if (!existing.factions.includes(faction)) existing.factions.push(faction);
        existing.ability_ids.push(String(ability.ability_id));
        uses.set(grantType, existing);
      }
    }
  }

  const entries = [...uses.values()];
  const tokenCache = new Map(entries.map((entry) => [entry.grant_type, nameTokens(entry.grant_type)]));

  const classifications: GrantTypeClassification[] = entries.map((entry): GrantTypeClassification => {
    // Exact name match against a declared effect type means the grant is
    // standing in for a typed effect that already exists.
    const normalized = entry.grant_type.toLowerCase().replace(/_/g, "-");
    const matchesEffect = effectTypeSet.has(normalized) ? normalized : null;
    const coreAbility = coreAbilityMatch(entry.grant_type, coreCatalog);
    const duplicates = (matchesEffect || coreAbility) ? [] : entries
      .filter((other) => other.grant_type !== entry.grant_type)
      .filter((other) => jaccardTokens(
        tokenCache.get(entry.grant_type)!,
        tokenCache.get(other.grant_type)!,
      ) >= DUPLICATE_THRESHOLD)
      .map((other) => other.grant_type);
    // A core-ability reference is checked first: it is legitimate content that
    // needs re-encoding as an entity reference, not an invented mechanic.
    const verdict: GrantTypeClassification["verdict"] = coreAbility
      ? "references-core-ability"
      : matchesEffect
        ? "names-existing-effect"
        : duplicates.length ? "duplicate" : "novel";
    return {
      ...entry,
      verdict,
      matches_effect_type: matchesEffect,
      references_core_ability: coreAbility,
      duplicates,
    };
  }).sort((left, right) => right.uses - left.uses || left.grant_type.localeCompare(right.grant_type));

  const count = (verdict: GrantTypeClassification["verdict"]): number =>
    classifications.filter((entry) => entry.verdict === verdict).length;
  const usesOf = (verdict: GrantTypeClassification["verdict"]): number =>
    classifications.filter((entry) => entry.verdict === verdict)
      .reduce((sum, entry) => sum + entry.uses, 0);

  const audit: GrantTypeAudit = {
    records,
    files: files.length,
    distinct_grant_types: entries.length,
    total_uses: entries.reduce((sum, entry) => sum + entry.uses, 0),
    opaque_grant_only_records: opaqueOnly,
    classifications,
    summary: {
      distinct_grant_types: entries.length,
      references_core_ability: count("references-core-ability"),
      references_core_ability_uses: usesOf("references-core-ability"),
      names_existing_effect: count("names-existing-effect"),
      names_existing_effect_uses: usesOf("names-existing-effect"),
      duplicate: count("duplicate"),
      duplicate_uses: usesOf("duplicate"),
      novel: count("novel"),
      novel_uses: usesOf("novel"),
      single_use: entries.filter((entry) => entry.uses === 1).length,
      opaque_grant_only_records: opaqueOnly,
      opaque_share_of_records: records ? opaqueOnly / records : 0,
    },
  };
  return audit;
}

/** The frozen vocabulary: every string currently in use, plus nothing else. */
export function frozenVocabulary(audit: GrantTypeAudit): string[] {
  const vocabulary = audit.classifications.map((entry) => entry.grant_type).sort();
  // The vocabulary is emitted as a Rust enum, and `typify` rejects two variants
  // differing only in case. Two factions spelling one grant `Stealth` and
  // `stealth` therefore fails codegen with a panic naming neither the file nor
  // the fix. Catch it here, where the remedy is obvious: pick one spelling and
  // re-author the records using the other.
  const byLowercase = new Map<string, string[]>();
  for (const value of vocabulary) {
    const key = value.toLowerCase();
    byLowercase.set(key, [...(byLowercase.get(key) ?? []), value]);
  }
  const collisions = [...byLowercase.values()].filter((values) => values.length > 1);
  if (collisions.length > 0) {
    throw new Error(
      "grant_type vocabulary has case-only duplicates, which cannot become a Rust enum: "
        + collisions.map((values) => values.join(" / ")).join("; "),
    );
  }
  return vocabulary;
}

/**
 * The vocabulary as an `effect.schema.json` `$defs` entry.
 *
 * This freezes the vocabulary at its current contents. Nothing in use today
 * starts failing, and every NEW string is rejected at authoring time — which is
 * the point: an unconstrained `grant_type` is invisible to AJV, to the
 * describer (which echoes it back as prose), and to any fidelity metric.
 *
 * Kin to the sibling `rule-state-core-rule-slug`: a closed vocabulary,
 * AJV-enforced, referenced only from an `if/then` branch.
 *
 * The contents are NOT a design. Triage in `grant-type-audit.json` separates
 * the strings that duplicate an existing effect type, the near-duplicates of
 * each other, and the genuinely new ones. Shrinking this list is that work.
 */
export function grantTypeDef(vocabulary: readonly string[]): AnyRecord {
  return {
    $comment:
      "Frozen vocabulary for ability-grant modifier.grant_type, generated by "
      + "tools/src/audit-grant-types.ts from audited usage across all factions. "
      + "This is a snapshot of what exists, not an approved design: entries that "
      + "duplicate a declared effect type, near-duplicates of each other, and "
      + "single-use one-offs are all still present. Migrating those out shrinks "
      + "the list; adding to it should require a reason.",
    type: "string",
    enum: [...vocabulary],
  };
}

const isMain = process.argv[1]?.endsWith("audit-grant-types.ts") ?? false;
if (isMain) {
  auditGrantTypes().then((audit) => {
    console.log(JSON.stringify(audit.summary, null, 2));
    const show = (verdict: GrantTypeClassification["verdict"], limit: number): void => {
      const rows = audit.classifications.filter((entry) => entry.verdict === verdict).slice(0, limit);
      console.log(`\n${verdict} (showing ${rows.length}):`);
      for (const row of rows) {
        const extra = row.matches_effect_type ? ` → ${row.matches_effect_type}` : "";
        console.log(`  ${row.grant_type.padEnd(52)} x${String(row.uses).padStart(3)}`
          + `  ${row.factions.slice(0, 2).join(",")}${extra}`);
      }
    };
    show("references-core-ability", 20);
    show("names-existing-effect", 20);
    show("duplicate", 12);
    show("novel", 8);
    mkdirSync(PRIVATE_ROOT, { recursive: true });
    writeFileSync(join(PRIVATE_ROOT, "grant-type-audit.json"), JSON.stringify(audit, null, 2));
    const vocabulary = frozenVocabulary(audit);
    writeFileSync(
      join(PRIVATE_ROOT, "grant-type-vocabulary.json"),
      `${JSON.stringify(vocabulary, null, 2)}\n`,
    );
    writeFileSync(
      join(PRIVATE_ROOT, "grant-type-def.json"),
      `${JSON.stringify({ "grant-type": grantTypeDef(vocabulary) }, null, 2)}\n`,
    );
    console.log(`\nwrote ${join(PRIVATE_ROOT, "grant-type-audit.json")}`);
    console.log(`wrote ${join(PRIVATE_ROOT, "grant-type-vocabulary.json")} (${vocabulary.length} values)`);
    console.log(`wrote ${join(PRIVATE_ROOT, "grant-type-def.json")} (paste into effect.schema.json $defs)`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
