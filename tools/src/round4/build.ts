import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FrozenDataset } from "./contracts.js";
import { hashFile, hashJson } from "./hash.js";
import { readJson, readRunManifest, writeJson, writeRunManifest } from "./manifest.js";
import {
  ANNOTATIONS_PATH,
  DATASET_PATH,
  MANIFEST_PATH,
  PROCESS_APP,
  PROCESS_INPUT,
  REPO_ROOT,
} from "./paths.js";
import { QUESTION_CATALOG } from "./question-catalog.js";

const FORBIDDEN_INPUT = [
  /data[\\/]enrichment/i,
  /(?:^|[\\/])gold(?:[.\\/]|$)/i,
  /jev-orks/i,
  /(?:^|[\\/])(?:formation|fragment|search|perfect)(?:[.\\/]|$)/i,
  /round4[\\/]evaluator/i,
  /semantic-annotations/i,
];
const FORBIDDEN_BUNDLE = [
  /data[\\/]enrichment/i,
  /round4[\\/]evaluator/i,
  /semantic-annotations/i,
  /40kdc-jev-orks/i,
];
function inspectBundle(label: string, path: string, metafile: Record<string, unknown>): void {
  const rawInputs = metafile.inputs;
  const inputs = rawInputs && typeof rawInputs === "object" && !Array.isArray(rawInputs)
    ? Object.keys(rawInputs)
    : [];
  const inputHit = FORBIDDEN_INPUT.find((pattern) => pattern.test(inputs.join("\n")));
  if (inputHit) throw new Error(`${label} bundle references forbidden dependency: ${inputHit}`);
  const content = readFileSync(path, "utf8");
  const contentHit = FORBIDDEN_BUNDLE.find((pattern) => pattern.test(content));
  if (contentHit) throw new Error(`${label} bundle embeds forbidden parser input: ${contentHit}`);
}

function collectVocabulary(value: unknown, path = "$", output: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || output.length >= 240) return output;
  const node = value as Record<string, unknown>;
  const row: Record<string, unknown> = { path };
  for (const key of ["title", "description", "type", "enum", "const"] as const) if (node[key] !== undefined) row[key] = node[key];
  if (Object.keys(row).length > 1) output.push(row);
  for (const key of ["properties", "$defs"] as const) {
    const children = node[key];
    if (!children || typeof children !== "object" || Array.isArray(children)) continue;
    for (const [name, child] of Object.entries(children as Record<string, unknown>)) collectVocabulary(child, `${path}/${key}/${name}`, output);
  }
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const children = node[key];
    if (Array.isArray(children)) children.forEach((child, index) => collectVocabulary(child, `${path}/${key}/${index}`, output));
  }
  if (node.items) collectVocabulary(node.items, `${path}/items`, output);
  return output;
}

async function bundle(entry: string, outfile: string, label: string): Promise<Record<string, unknown>> {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: false,
    metafile: true,
    treeShaking: true,
    logLevel: "silent",
  });
  const meta = result.metafile as unknown as Record<string, unknown>;
  inspectBundle(label, outfile, meta);
  writeJson(join(PROCESS_APP, `${label}.meta.json`), meta);
  return meta;
}

async function main(): Promise<void> {
  mkdirSync(PROCESS_APP, { recursive: true });
  mkdirSync(PROCESS_INPUT, { recursive: true });
  const dataset = readJson<FrozenDataset>(DATASET_PATH);
  const annotations = readJson<{ run_id: string; annotations: Array<{ identity: { faction_id: string; ability_id: string }; source_hash: string }> }>(ANNOTATIONS_PATH);
  if (annotations.run_id !== dataset.run_id || annotations.annotations.length !== 32) throw new Error("Annotations are not frozen for this 32-record run");
  const sourceHashes = new Map(dataset.records.map((record) => [`${record.faction_id}/${record.ability_id}`, record.source_hash]));
  for (const annotation of annotations.annotations) {
    const key = `${annotation.identity.faction_id}/${annotation.identity.ability_id}`;
    if (sourceHashes.get(key) !== annotation.source_hash) throw new Error(`Annotation source drift for ${key}`);
  }

  const parserPath = join(PROCESS_APP, "parser.mjs");
  const composerPath = join(PROCESS_APP, "composer.mjs");
  await bundle(join(REPO_ROOT, "tools", "src", "round4", "parser-entry.ts"), parserPath, "parser");
  await bundle(join(REPO_ROOT, "tools", "src", "round4", "composer-entry.ts"), composerPath, "composer");

  const schemaNames = ["ability", "effect", "condition", "scope"];
  const schemaContext = Object.fromEntries(schemaNames.map((name) => {
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, "schemas", "enrichment", "ability-dsl", `${name}.schema.json`), "utf8")) as unknown;
    return [name, collectVocabulary(schema)];
  }));
  writeJson(join(PROCESS_INPUT, "schema-context.json"), schemaContext);

  const current = readRunManifest(MANIFEST_PATH);
  const { manifest_hash: _, ...body } = current;
  const next = {
    ...body,
    annotation_hash: hashFile(ANNOTATIONS_PATH),
    parser_bundle_hash: hashFile(parserPath),
    composer_bundle_hash: hashFile(composerPath),
    question_catalog_hash: hashJson(QUESTION_CATALOG),
  };
  writeRunManifest(MANIFEST_PATH, next);
  cpSync(DATASET_PATH, join(PROCESS_INPUT, "round4-dataset.json"));
  cpSync(MANIFEST_PATH, join(PROCESS_INPUT, "run-manifest.json"));
  writeFileSync(join(PROCESS_APP, "bundle-hashes.json"), `${JSON.stringify({
    parser: next.parser_bundle_hash,
    composer: next.composer_bundle_hash,
    question_catalog: next.question_catalog_hash,
    annotations: next.annotation_hash,
  }, null, 2)}\n`);
  process.stdout.write(`froze parser ${next.parser_bundle_hash}\n`);
  process.stdout.write(`froze composer ${next.composer_bundle_hash}\n`);
}

await main();
