import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { ROUND4_COHORT } from "./cohort.js";
import type { FrozenAbility, FrozenDataset, SourceFragment } from "./contracts.js";
import { hashJson, sha256Bytes } from "./hash.js";
import { sourceDigest } from "../source-digest.js";
import {
  ABILITIES_ROOT,
  DATASET_PATH,
  EVALUATOR_ROOT,
  MANIFEST_PATH,
  PROCESS_APP,
  PROCESS_INPUT,
  PROCESS_OUTPUT,
  ROUND4_ROOT,
} from "./paths.js";
import { requireAbsent, writeJson, writeRunManifest } from "./manifest.js";

interface SourceRecord {
  faction?: string;
  raw_text?: string;
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
}

type SourceIndex = Record<string, Record<string, SourceRecord>>;

const FIELDS = ["when", "target", "effect", "restrictions"] as const;
const LABELS: Record<(typeof FIELDS)[number], SourceFragment["label"]> = {
  when: "WHEN",
  target: "TARGET",
  effect: "EFFECT",
  restrictions: "RESTRICTIONS",
};

function titleFromId(id: string): string {
  return id.split("-").map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(" ");
}

function assemble(record: SourceRecord): {
  source_text: string;
  source_fragments: SourceFragment[];
  source_kind: FrozenAbility["card"]["source_kind"];
} {
  if (typeof record.raw_text === "string" && record.raw_text.length > 0) {
    const bytes = Buffer.byteLength(record.raw_text, "utf8");
    return {
      source_text: record.raw_text,
      source_fragments: [{ label: "RAW_TEXT", start: 0, end: bytes }],
      source_kind: "raw-text",
    };
  }
  const present = FIELDS.filter((field) => typeof record[field] === "string" && record[field]!.length > 0);
  if (!present.length) throw new Error("Source record contains neither raw_text nor structured fields");
  const pieces: string[] = [];
  const fragments: SourceFragment[] = [];
  let byteCursor = 0;
  for (const field of present) {
    const label = LABELS[field];
    const prefix = `${label}: `;
    const value = record[field] as string;
    if (pieces.length) byteCursor += 1;
    pieces.push(`${prefix}${value}`);
    const start = byteCursor + Buffer.byteLength(prefix, "utf8");
    const end = start + Buffer.byteLength(value, "utf8");
    fragments.push({ label, start, end });
    byteCursor = end;
  }
  return { source_text: pieces.join("\n"), source_fragments: fragments, source_kind: "structured-stratagem" };
}

export function freezeDataset(now = new Date()): FrozenDataset {
  requireAbsent(DATASET_PATH, "Round 4 dataset");
  const indexPath = join(ABILITIES_ROOT, "index.json");
  const sourceIndex = JSON.parse(readFileSync(indexPath, "utf8")) as SourceIndex;
  const identities = new Set<string>();
  const records: FrozenAbility[] = ROUND4_COHORT.map((spec) => {
    const key = `${spec.faction_id}/${spec.ability_id}`;
    if (identities.has(key)) throw new Error(`Duplicate cohort identity ${key}`);
    identities.add(key);
    const factionRecords = sourceIndex[spec.faction_id];
    const record = factionRecords?.[spec.ability_id];
    if (!record) throw new Error(`Frozen-cohort prerequisite failure: source record absent: ${key}`);
    if (record.faction && record.faction !== spec.faction_id) {
      throw new Error(`Frozen-cohort prerequisite failure: ambiguous faction identity for ${key}`);
    }
    const assembled = assemble(record);
    const bytes = Buffer.from(assembled.source_text, "utf8");
    const sourceFile = `${spec.faction_id}.json`;
    return {
      ...spec,
      name: titleFromId(spec.ability_id),
      card: { source_kind: assembled.source_kind, fields: assembled.source_fragments.map((item) => item.label) },
      source_locator: `${join(ABILITIES_ROOT, sourceFile)}#/${spec.ability_id}`,
      source_text: assembled.source_text,
      source_bytes_base64: bytes.toString("base64"),
      source_byte_length: bytes.length,
      source_hash: sha256Bytes(bytes),
      source_digest: sourceDigest(assembled.source_text),
      source_provenance: {
        repository: "40kdc-abilities",
        file: sourceFile,
        record_pointer: `/${spec.ability_id}`,
      },
      source_fragments: assembled.source_fragments,
    };
  });
  if (records.length !== 32) throw new Error(`Frozen cohort must contain 32 records; received ${records.length}`);
  const cohort_hash = hashJson(records.map(({ faction_id, ability_id, source_hash }) => ({ faction_id, ability_id, source_hash })));
  return {
    run_id: `round4-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    contract_version: 1,
    frozen_at: now.toISOString(),
    cohort_hash,
    records,
  };
}

function main(): void {
  mkdirSync(ROUND4_ROOT, { recursive: true });
  mkdirSync(EVALUATOR_ROOT, { recursive: true });
  mkdirSync(PROCESS_INPUT, { recursive: true });
  mkdirSync(PROCESS_APP, { recursive: true });
  mkdirSync(PROCESS_OUTPUT, { recursive: true });
  const dataset = freezeDataset();
  writeJson(DATASET_PATH, dataset);
  writeJson(join(PROCESS_INPUT, basename(DATASET_PATH)), dataset);
  const datasetHash = sha256Bytes(readFileSync(DATASET_PATH));
  writeRunManifest(MANIFEST_PATH, {
    run_id: dataset.run_id,
    contract_version: 1,
    frozen_at: dataset.frozen_at,
    annotation_hash: "",
    dataset_hash: datasetHash,
    parser_bundle_hash: null,
    composer_bundle_hash: null,
    question_catalog_hash: null,
    direct_price_table: {
      version: "deepseek-2025-02",
      input_per_million_usd: 0.55,
      output_per_million_usd: 2.19,
    },
    stages: [{
      run_id: dataset.run_id,
      stage: "freeze",
      created_at: new Date().toISOString(),
      input_hashes: { source_index: sha256Bytes(readFileSync(join(ABILITIES_ROOT, "index.json"))) },
      bundle_hashes: {},
      output_hashes: { dataset: datasetHash },
      model: null,
      prompt_hash: null,
      question_catalog_hash: null,
      request_hashes: [],
    }],
  });
  writeFileSync(join(ROUND4_ROOT, "FREEZE"), `${dataset.run_id}\n`);
  process.stdout.write(`${dataset.run_id}: froze ${dataset.records.length} records\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
