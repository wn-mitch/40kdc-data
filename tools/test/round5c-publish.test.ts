import { createRequire } from "node:module";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { describeAbility } from "../src/translate/effect.js";
import { draftVerificationSnapshot, recordDraftVerification, schemaTreeHash } from "../src/round5c/assembly.js";
import { initializeWorkbench } from "../src/round5c/db.js";
import {
  getPublicationReport,
  listPublications,
  preparePublication,
  publishPublication,
  reconcilePublicationBatches,
} from "../src/round5c/publish.js";
import { refreshSources } from "../src/round5c/source.js";
import { hashJson } from "../src/round4/hash.js";
import { sourceDigest } from "../src/source-digest.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

const repositoryRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const liveDataRoot = join(repositoryRoot, "data");
const factionId = "adepta-sororitas";
const selectedAbilityId = "anchorite-sarcophagus";
const authoredAbilityId = "deep-strike";
const privateSourceText = "PRIVATE SOURCE PROSE: add one to this model's Move characteristic.";
const authoredSourceText = "PRIVATE SOURCE PROSE: deploy this unit away from enemy models.";
const temporaryDirectories: string[] = [];
const originalDataRoot = process.env.ROUND5C_DATA_ROOT;
const originalRawStore = process.env.RAW_TEXT_STORE;

afterEach(() => {
  if (originalDataRoot === undefined) delete process.env.ROUND5C_DATA_ROOT;
  else process.env.ROUND5C_DATA_ROOT = originalDataRoot;
  if (originalRawStore === undefined) delete process.env.RAW_TEXT_STORE;
  else process.env.RAW_TEXT_STORE = originalRawStore;
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type Fixture = {
  db: DatabaseSync;
  dataRoot: string;
  rawStore: string;
  abilitiesFile: string;
  selectedDraftId: string;
  authoredDraftId: string;
  selectedStampId: string;
};

function entriesAt(file: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
}

function writeEntries(file: string, entries: Array<Record<string, unknown>>): void {
  writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
}

function seedAcceptedDraft(
  db: DatabaseSync,
  entry: Record<string, unknown>,
  abilityVersionId: number,
  sourceHash: string,
  suffix: string,
): { draftId: string; stampId: string } {
  const now = "2026-01-01T00:00:00.000Z";
  const stampId = `fixture-composition-${suffix}`;
  const definitionHash = hashJson({ stamp_id: stampId, fixture: true });
  const batchId = `fixture-approval-${suffix}`;
  db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES (?, 'stamp-approval', 'fixture-reviewer-secret', ?)")
    .run(batchId, now);
  db.prepare(`
    INSERT INTO stamps (
      id, revision, kind, status, definition_json, definition_hash,
      approval_batch_id, created_at, updated_at
    ) VALUES (?, 1, 'composition', 'approved', ?, ?, ?, ?, ?)
  `).run(stampId, JSON.stringify({ schema_version: 1, kind: "composition", label: suffix, variants: [] }), definitionHash, batchId, now, now);

  const applicationId = `fixture-application-${suffix}`;
  const dependencies = {
    assembler_version: "round5c/stamp-assembler/v1",
    stamp: { id: stampId, revision: 1, definition_hash: definitionHash },
    source_hash: sourceHash,
    leaf_annotation_ids: [],
    schema_hash: schemaTreeHash(),
    entity: { faction_id: factionId, ability_id: entry.ability_id, entry_hash: hashJson(entry) },
  };
  const bindings = {};
  const proposedEffect = {
    type: "stat-modifier",
    target: "self",
    modifier: { stat: "M", operation: "add", value: 1 },
  };
  const mechanics = {
    ...entry,
    effect: proposedEffect,
    scope: { range: "unit", duration: "permanent" },
    behavior: "passive",
  } as Record<string, unknown>;
  delete mechanics.trigger;
  delete mechanics.usage;
  delete mechanics.applies_to;
  const graph = { schema_version: 1, nodes: [], relations: [], roots: [] };
  const inputsHash = hashJson({ dependencies, bindings, graph, mechanics });
  db.prepare(`
    INSERT INTO stamp_applications (
      id, stamp_id, stamp_revision, ability_version_id, variant_id, inputs_hash,
      bindings_json, dependencies_json, status, created_at, updated_at
    ) VALUES (?, ?, 1, ?, 'fixture', ?, ?, ?, 'active', ?, ?)
  `).run(applicationId, stampId, abilityVersionId, inputsHash, JSON.stringify(bindings), JSON.stringify(dependencies), now, now);

  const draftId = `fixture-draft-${suffix}`;
  db.prepare(`
    INSERT INTO assembly_drafts (
      id, composition_application_id, graph_json, mechanics_json, rendered_text,
      inputs_hash, schema_hash, status, diagnostic_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', '{}', ?, ?)
  `).run(
    draftId,
    applicationId,
    JSON.stringify(graph),
    JSON.stringify(mechanics),
    describeAbility(mechanics as never),
    inputsHash,
    schemaTreeHash(),
    now,
    now,
  );
  const snapshot = draftVerificationSnapshot(db, draftId);
  const output = {
    items: [{
      item_id: draftId,
      evidence_hash: snapshot.evidence_hash,
      result: { faithful: true, severity: "ok", findings: [] },
    }],
  };
  const run = db.prepare(`
    INSERT INTO model_runs (
      model, model_version, prompt_version, input_hash, config_json, output_json, status, created_at
    ) VALUES ('fixture-verifier', 'fixture-version', 'fixture-verify-v1', ?, '{}', ?, 'completed', ?)
  `).run(hashJson(snapshot), JSON.stringify(output), now);
  recordDraftVerification(db, {
    draft_id: draftId,
    verifier_run_id: Number(run.lastInsertRowid),
  }, () => "unused-escalation");
  return { draftId, stampId };
}

function buildFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "round5c-publish-"));
  temporaryDirectories.push(directory);
  const dataRoot = join(directory, "data");
  cpSync(liveDataRoot, dataRoot, { recursive: true });
  const rawStore = join(directory, "raw-store");
  mkdirSync(rawStore, { recursive: true });
  process.env.ROUND5C_DATA_ROOT = dataRoot;
  process.env.RAW_TEXT_STORE = rawStore;

  const abilitiesFile = join(dataRoot, "enrichment", factionId, "abilities.json");
  const originalEntries = entriesAt(abilitiesFile);
  const fixtureEntries = structuredClone(originalEntries);
  const selected = fixtureEntries.find((entry) => entry.ability_id === selectedAbilityId)!;
  selected.effect = { type: "stat-modifier", target: "self", modifier: {} };
  selected.behavior = "reactive";
  selected.community_notes = "metadata-must-survive";
  const authored = fixtureEntries.find((entry) => entry.ability_id === authoredAbilityId)!;
  writeEntries(abilitiesFile, fixtureEntries);
  writeFileSync(join(rawStore, `${factionId}.json`), JSON.stringify([{
    faction_id: factionId,
    ability_id: selectedAbilityId,
    name: "Fixture selected ability",
    ability_type: "unit",
    raw_text: privateSourceText,
  }, {
    faction_id: factionId,
    ability_id: authoredAbilityId,
    name: "Fixture authored ability",
    ability_type: "core",
    raw_text: authoredSourceText,
  }]));

  const db = new DatabaseSync(":memory:");
  initializeWorkbench(db);
  refreshSources(db, rawStore);
  const selectedAbility = db.prepare("SELECT id, source_hash FROM abilities WHERE faction_id = ? AND ability_id = ? AND current = 1")
    .get(factionId, selectedAbilityId) as { id: number; source_hash: string };
  const authoredAbility = db.prepare("SELECT id, source_hash FROM abilities WHERE faction_id = ? AND ability_id = ? AND current = 1")
    .get(factionId, authoredAbilityId) as { id: number; source_hash: string };
  const selectedDraft = seedAcceptedDraft(db, selected, selectedAbility.id, selectedAbility.source_hash, "selected");
  const authoredDraft = seedAcceptedDraft(db, authored, authoredAbility.id, authoredAbility.source_hash, "authored");
  return {
    db,
    dataRoot,
    rawStore,
    abilitiesFile,
    selectedDraftId: selectedDraft.draftId,
    authoredDraftId: authoredDraft.draftId,
    selectedStampId: selectedDraft.stampId,
  };
}

function cloneAsPublishing(db: DatabaseSync, sourceBatchId: string, targetBatchId: string): { manifest: Record<string, unknown> } {
  const source = db.prepare("SELECT faction_id, manifest_json, created_at FROM publication_batches WHERE id = ?")
    .get(sourceBatchId) as { faction_id: string; manifest_json: string; created_at: string };
  const manifest = { ...(JSON.parse(source.manifest_json) as Record<string, unknown>), batch_id: targetBatchId };
  delete manifest.receipt;
  delete manifest.failure;
  const previewHash = hashJson(manifest);
  db.prepare(`
    INSERT INTO publication_batches (id, preview_hash, faction_id, state, manifest_json, created_at, updated_at)
    VALUES (?, ?, ?, 'publishing', ?, ?, ?)
  `).run(targetBatchId, previewHash, source.faction_id, JSON.stringify(manifest), source.created_at, source.created_at);
  return { manifest };
}

describe("Round 5C explicit publication", () => {
  it("previews without writes, then publishes only selected mechanics and source digest with a private receipt", async () => {
    const fixture = buildFixture();
    try {
      const beforeText = readFileSync(fixture.abilitiesFile, "utf8");
      const beforeEntries = entriesAt(fixture.abilitiesFile);
      const untouchedBefore = structuredClone(beforeEntries.find((entry) => entry.ability_id === authoredAbilityId));
      const selectedBefore = structuredClone(beforeEntries.find((entry) => entry.ability_id === selectedAbilityId));

      const preview = await preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      });
      expect(readFileSync(fixture.abilitiesFile, "utf8")).toBe(beforeText);
      expect(preview).toMatchObject({ faction_id: factionId, ability_ids: [selectedAbilityId], reauthor: false });
      expect(listPublications(fixture.db).items[0]).toMatchObject({ state: "prepared", receipt: null });

      const receipt = await publishPublication(fixture.db, {
        batch_id: preview.batch_id,
        preview_hash: preview.preview_hash,
      });
      expect(receipt).toMatchObject({ state: "published", recovered: false, ability_ids: [selectedAbilityId] });
      const afterText = readFileSync(fixture.abilitiesFile, "utf8");
      const afterEntries = entriesAt(fixture.abilitiesFile);
      const selectedAfter = afterEntries.find((entry) => entry.ability_id === selectedAbilityId)!;
      const untouchedAfter = afterEntries.find((entry) => entry.ability_id === authoredAbilityId)!;
      expect(selectedAfter).toMatchObject({
        ability_id: selectedAbilityId,
        behavior: "passive",
        community_notes: "metadata-must-survive",
        effect: { type: "stat-modifier", target: "self", modifier: { stat: "M", operation: "add", value: 1 } },
        source_digest: sourceDigest(privateSourceText),
      });
      expect(untouchedAfter).toEqual(untouchedBefore);
      expect(selectedAfter.name).toBe(selectedBefore?.name);
      expect(selectedAfter.unit_ids).toEqual(selectedBefore?.unit_ids);
      expect(afterText).not.toContain(privateSourceText);
      expect(afterText).not.toContain("fixture-reviewer-secret");
      await expect(publishPublication(fixture.db, {
        batch_id: preview.batch_id,
        preview_hash: preview.preview_hash,
      })).resolves.toEqual(receipt);
      expect(listPublications(fixture.db).items[0]).toMatchObject({ state: "published", evidence_status: "current" });
      expect(getPublicationReport(fixture.db)).toMatchObject({
        states: { published: 1 },
        stale_published_abilities: [],
        total_batches: 1,
        recent_batches: [{ batch_id: preview.batch_id, state: "published", receipt: { actual_after_hash: receipt.actual_after_hash } }],
      });
    } finally {
      fixture.db.close();
    }
  }, 120_000);

  it("refuses authored replacement and every stale source, verifier, rule, schema, entity, preview, and validation gate", async () => {
    const fixture = buildFixture();
    try {
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.authoredDraftId],
        reauthor: false,
      })).rejects.toThrow(/already has an authored effect.*--reauthor/i);

      const sourceFile = join(fixture.rawStore, `${factionId}.json`);
      const rawSource = readFileSync(sourceFile, "utf8");
      writeFileSync(sourceFile, rawSource.replace(privateSourceText, `${privateSourceText} Changed.`));
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toMatchObject({ status: 409 });
      writeFileSync(sourceFile, rawSource);
      const sourceRecords = JSON.parse(rawSource) as Array<Record<string, unknown>>;
      writeFileSync(sourceFile, JSON.stringify(sourceRecords.filter((entry) => entry.ability_id !== selectedAbilityId)));
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/fresh source is missing/i);
      writeFileSync(sourceFile, rawSource);

      const changedTypeRecords = JSON.parse(rawSource) as Array<Record<string, unknown>>;
      changedTypeRecords.find((entry) => entry.ability_id === selectedAbilityId)!.ability_type = "enhancement";
      writeFileSync(sourceFile, JSON.stringify(changedTypeRecords));
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toMatchObject({ status: 409 });
      writeFileSync(sourceFile, rawSource);

      const changedFragmentRecords = JSON.parse(rawSource) as Array<Record<string, unknown>>;
      const changedFragment = changedFragmentRecords.find((entry) => entry.ability_id === selectedAbilityId)!;
      delete changedFragment.raw_text;
      changedFragment.effect = privateSourceText;
      writeFileSync(sourceFile, JSON.stringify(changedFragmentRecords));
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toMatchObject({ status: 409 });
      writeFileSync(sourceFile, rawSource);

      fixture.db.prepare("UPDATE stamps SET status = 'suspended' WHERE id = ? AND revision = 1").run(fixture.selectedStampId);
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/active authority|stale/i);
      fixture.db.prepare("UPDATE stamps SET status = 'approved' WHERE id = ? AND revision = 1").run(fixture.selectedStampId);

      const stamp = fixture.db.prepare("SELECT definition_hash FROM stamps WHERE id = ? AND revision = 1")
        .get(fixture.selectedStampId) as { definition_hash: string };
      fixture.db.prepare("UPDATE stamps SET definition_hash = ? WHERE id = ? AND revision = 1")
        .run("d".repeat(64), fixture.selectedStampId);
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/source or rule dependency is stale/i);
      fixture.db.prepare("UPDATE stamps SET definition_hash = ? WHERE id = ? AND revision = 1")
        .run(stamp.definition_hash, fixture.selectedStampId);

      const draft = fixture.db.prepare("SELECT schema_hash, diagnostic_json FROM assembly_drafts WHERE id = ?")
        .get(fixture.selectedDraftId) as { schema_hash: string; diagnostic_json: string };
      fixture.db.prepare("UPDATE assembly_drafts SET schema_hash = ? WHERE id = ?").run("0".repeat(64), fixture.selectedDraftId);
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/schema snapshot is stale/i);
      fixture.db.prepare("UPDATE assembly_drafts SET schema_hash = ? WHERE id = ?").run(draft.schema_hash, fixture.selectedDraftId);

      const diagnostic = JSON.parse(draft.diagnostic_json) as { verdict: { severity: string } };
      diagnostic.verdict.severity = "minor";
      fixture.db.prepare("UPDATE assembly_drafts SET diagnostic_json = ? WHERE id = ?")
        .run(JSON.stringify(diagnostic), fixture.selectedDraftId);
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/faithful verifier receipt/i);
      fixture.db.prepare("UPDATE assembly_drafts SET diagnostic_json = ? WHERE id = ?").run(draft.diagnostic_json, fixture.selectedDraftId);

      const verifier = fixture.db.prepare(`
        SELECT model_runs.id, model_runs.output_json
        FROM assembly_drafts
        JOIN model_runs ON model_runs.id = assembly_drafts.verifier_run_id
        WHERE assembly_drafts.id = ?
      `).get(fixture.selectedDraftId) as { id: number; output_json: string };
      const staleOutput = JSON.parse(verifier.output_json) as { items: Array<{ result: { severity: string } }> };
      staleOutput.items[0]!.result.severity = "minor";
      fixture.db.prepare("UPDATE model_runs SET output_json = ? WHERE id = ?").run(JSON.stringify(staleOutput), verifier.id);
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/verifier output is stale/i);
      fixture.db.prepare("UPDATE model_runs SET output_json = ? WHERE id = ?").run(verifier.output_json, verifier.id);

      const mechanicsRow = fixture.db.prepare(`
        SELECT assembly_drafts.graph_json, assembly_drafts.mechanics_json, assembly_drafts.inputs_hash,
          stamp_applications.dependencies_json, stamp_applications.bindings_json
        FROM assembly_drafts
        JOIN stamp_applications ON stamp_applications.id = assembly_drafts.composition_application_id
        WHERE assembly_drafts.id = ?
      `).get(fixture.selectedDraftId) as {
        graph_json: string;
        mechanics_json: string;
        inputs_hash: string;
        dependencies_json: string;
        bindings_json: string;
      };
      const invalidMechanics = JSON.parse(mechanicsRow.mechanics_json) as Record<string, unknown>;
      invalidMechanics.effect = { type: "not-a-real-effect" };
      const invalidInputsHash = hashJson({
        dependencies: JSON.parse(mechanicsRow.dependencies_json),
        bindings: JSON.parse(mechanicsRow.bindings_json),
        graph: JSON.parse(mechanicsRow.graph_json),
        mechanics: invalidMechanics,
      });
      fixture.db.prepare("UPDATE assembly_drafts SET mechanics_json = ?, inputs_hash = ? WHERE id = ?")
        .run(JSON.stringify(invalidMechanics), invalidInputsHash, fixture.selectedDraftId);
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/ability schema/i);
      fixture.db.prepare("UPDATE assembly_drafts SET mechanics_json = ?, inputs_hash = ? WHERE id = ?")
        .run(mechanicsRow.mechanics_json, mechanicsRow.inputs_hash, fixture.selectedDraftId);

      const originalFile = readFileSync(fixture.abilitiesFile, "utf8");
      writeEntries(fixture.abilitiesFile, entriesAt(fixture.abilitiesFile).filter((entry) => entry.ability_id !== selectedAbilityId));
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/entity dependency is stale|missing from the destination/i);
      writeFileSync(fixture.abilitiesFile, originalFile);

      const preview = await preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      });
      await expect(publishPublication(fixture.db, {
        batch_id: preview.batch_id,
        preview_hash: "f".repeat(64),
      })).rejects.toThrow(/preview hash/i);
      writeFileSync(fixture.abilitiesFile, `${originalFile}\n`);
      await expect(publishPublication(fixture.db, {
        batch_id: preview.batch_id,
        preview_hash: preview.preview_hash,
      })).rejects.toThrow(/entity dependency is stale|preview is stale/i);
      writeFileSync(fixture.abilitiesFile, originalFile);

      const invalidInput = join(fixture.dataRoot, "core", "world-eaters", "units.json");
      const validInput = readFileSync(invalidInput, "utf8");
      writeFileSync(invalidInput, "not-json\n");
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/projected dataset fails validation/i);
      writeFileSync(invalidInput, validInput);
      expect(fixture.db.prepare("SELECT count(*) AS count FROM publication_batches").get()).toEqual({ count: 1 });
    } finally {
      fixture.db.close();
    }
  }, 180_000);

  it("rejects a faction destination that resolves through a symlink outside the configured data root", async () => {
    const fixture = buildFixture();
    try {
      const factionDirectory = dirname(fixture.abilitiesFile);
      const outsideDirectory = join(dirname(fixture.dataRoot), "outside-faction");
      renameSync(factionDirectory, outsideDirectory);
      symlinkSync(outsideDirectory, factionDirectory, "dir");
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      })).rejects.toThrow(/symlinked|escapes/i);
      expect(readFileSync(join(outsideDirectory, "abilities.json"), "utf8")).toBeTruthy();
      expect(fixture.db.prepare("SELECT count(*) AS count FROM publication_batches").get()).toEqual({ count: 0 });
    } finally {
      fixture.db.close();
    }
  }, 120_000);

  it("recovers durable publishing markers only from observed before/after hashes and reports external edits as conflicts", async () => {
    const fixture = buildFixture();
    try {
      const originalText = readFileSync(fixture.abilitiesFile, "utf8");
      const preview = await preparePublication(fixture.db, {
        faction_id: factionId,
        draft_ids: [fixture.selectedDraftId],
        reauthor: false,
      });

      cloneAsPublishing(fixture.db, preview.batch_id, "pub-before-rename");
      expect(reconcilePublicationBatches(fixture.db, "pub-before-rename")).toEqual({ recovered: [], failed: ["pub-before-rename"] });
      expect(listPublications(fixture.db).items.find((item) => item.batch_id === "pub-before-rename")).toMatchObject({
        state: "failed",
        failure: { reason_code: "NO_WRITE_OBSERVED" },
      });
      expect(readFileSync(fixture.abilitiesFile, "utf8")).toBe(originalText);

      const otherDataRoot = join(dirname(fixture.dataRoot), "other-data");
      cpSync(fixture.dataRoot, otherDataRoot, { recursive: true });
      const otherRoot = cloneAsPublishing(fixture.db, preview.batch_id, "pub-other-root");
      writeFileSync(join(otherDataRoot, "enrichment", factionId, "abilities.json"), String(otherRoot.manifest.after_text));
      process.env.ROUND5C_DATA_ROOT = otherDataRoot;
      expect(reconcilePublicationBatches(fixture.db, "pub-other-root")).toEqual({ recovered: [], failed: ["pub-other-root"] });
      expect(listPublications(fixture.db).items.find((item) => item.batch_id === "pub-other-root")).toMatchObject({
        state: "failed",
        failure: { reason_code: "NO_WRITE_OBSERVED" },
      });
      const pinnedManifest = fixture.db.prepare("SELECT manifest_json FROM publication_batches WHERE id='pub-other-root'")
        .get() as { manifest_json: string };
      expect(JSON.parse(pinnedManifest.manifest_json)).toMatchObject({
        data_root: realpathSync(fixture.dataRoot),
        destination: realpathSync(fixture.abilitiesFile),
      });
      expect(readFileSync(fixture.abilitiesFile, "utf8")).toBe(originalText);
      process.env.ROUND5C_DATA_ROOT = fixture.dataRoot;

      const afterRename = cloneAsPublishing(fixture.db, preview.batch_id, "pub-after-rename");
      writeFileSync(fixture.abilitiesFile, String(afterRename.manifest.after_text));
      const recovered = reconcilePublicationBatches(fixture.db, "pub-after-rename");
      expect(recovered.recovered[0]).toMatchObject({ batch_id: "pub-after-rename", state: "published", recovered: true });
      expect(recovered.failed).toEqual([]);

      writeFileSync(fixture.abilitiesFile, originalText);
      cloneAsPublishing(fixture.db, preview.batch_id, "pub-external-conflict");
      writeFileSync(fixture.abilitiesFile, `${originalText} `);
      expect(reconcilePublicationBatches(fixture.db, "pub-external-conflict")).toEqual({ recovered: [], failed: ["pub-external-conflict"] });
      expect(listPublications(fixture.db).items.find((item) => item.batch_id === "pub-external-conflict")).toMatchObject({
        state: "failed",
        failure: { reason_code: "EXTERNAL_CHANGE_CONFLICT" },
      });
    } finally {
      fixture.db.close();
    }
  }, 120_000);
});
