import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const privateRoot = process.argv[2] ? resolve(process.argv[2]) : null;
const oldReviewPath = process.argv[3] ? resolve(process.argv[3]) : null;
const outputPath = process.argv[4]
  ? resolve(process.argv[4])
  : privateRoot
    ? join(privateRoot, "review-bundle-v2.json")
    : null;
if (!privateRoot || !outputPath) {
  throw new Error("Usage: npm run review:prepare -- PRIVATE_PILOT_ROOT [OLD_REVIEW_JSON] [OUTPUT_JSON]");
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const assembled = readJson(join(privateRoot, "assembled.json")) as Array<Record<string, any>>;
const manifest = readJson(join(privateRoot, "manifest.json")) as { records: Array<Record<string, any>> };
const baseline = readJson(join(privateRoot, "baseline-renders.json")) as Array<Record<string, any>>;
const originalReview = readJson(join(privateRoot, "human-review.json")) as { items: Array<Record<string, any>> };
const oldReview = oldReviewPath ? readJson(oldReviewPath) as { items?: Array<Record<string, any>> } : null;

const frozenByKey = new Map(manifest.records.map((record) => [record.key, record]));
const baselineByKey = new Map(baseline.map((record) => [record.key, record]));
const initialById = new Map(originalReview.items.map((item) => [`${item.key}#${item.component_id}`, item]));
const oldById = new Map((oldReview?.items ?? []).map((item) => [`${item.key}#${item.component_id}`, item]));

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const items = assembled.flatMap((record) => record.components.map((component: Record<string, any>) => {
  const frozen = frozenByKey.get(record.key);
  const current = baselineByKey.get(record.key);
  const initial = initialById.get(`${record.key}#${component.id}`);
  const old = oldById.get(`${record.key}#${component.id}`);
  if (!frozen || !current || !initial) throw new Error(`Missing pilot dependency for ${record.key}/${component.id}`);
  const residuals = [
    ...(record.residuals ?? []),
    ...(record.blocked_components ?? []).map((blocked: Record<string, unknown>) => ({ ...blocked, category: "blocked-component" })),
  ];
  const residualLedgerDigest = createHash("sha256").update(stableJson({
    source_obligations: record.source_obligations ?? [],
    represented_obligations: component.obligation_ids ?? [],
    residuals,
    ledger: record.ledger ?? null,
  })).digest("hex");
  const [factionId, abilityId] = String(record.key).split("/", 2);
  return {
    key: record.key,
    component_id: component.id,
    name: frozen.name ?? frozen.ability_name ?? abilityId,
    faction_id: factionId,
    source_text: frozen.source_text,
    candidate_render: component.render,
    current_render: current.render,
    candidate_entry: component.candidate,
    current_entry: frozen.current_entry ?? frozen.entry,
    residuals,
    component_shape: component.candidate?.effect?.type,
    component_parameters: component.candidate?.effect,
    source_digest: initial.source_digest,
    base_entry_digest: initial.base_digest ?? record.base_digest,
    candidate_entry_digest: initial.entry_digest,
    render_digest: initial.render_digest,
    residual_ledger_digest: residualLedgerDigest,
    schema_valid: component.schema_valid,
    canonical: component.canonical,
    canonical_issues: component.canonical_issues ?? [],
    legacy_review: old ? { decision: old.decision, note: old.note ?? "" } : undefined,
  };
}));

writeFileSync(outputPath, `${JSON.stringify({
  kind: "partial-component-review-bundle-v2",
  instruction: "Review component semantics independently from whole-ability completeness.",
  created_at: new Date().toISOString(),
  items,
}, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, items: items.length }));
