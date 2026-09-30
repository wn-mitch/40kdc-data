import { createRequire } from "node:module";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compilationInputsHash } from "../src/round5c/compiled.js";
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
import { applyAnnotationBatch } from "./round5c-human.js";

const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };
type DatabaseSync = DatabaseType;

const repositoryRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const liveDataRoot = join(repositoryRoot, "data");
const factionId = "adepta-sororitas";
const selectedAbilityId = "anchorite-sarcophagus-adepta-sororitas";
const authoredAbilityId = "sworn-protectors-adepta-sororitas";
const privateSourceText = "PRIVATE SOURCE PROSE: add one to this model's Move characteristic.";
const authoredSourceText = "PRIVATE SOURCE PROSE: deploy this unit away from enemy models.";
const temporaryDirectories: string[] = [];
const originalDataRoot = process.env.ROUND5C_DATA_ROOT;
const originalRawStore = process.env.ROUND5C_SOURCE_FIXTURE;

afterEach(() => {
  if (originalDataRoot === undefined) delete process.env.ROUND5C_DATA_ROOT;
  else process.env.ROUND5C_DATA_ROOT = originalDataRoot;
  if (originalRawStore === undefined) delete process.env.ROUND5C_SOURCE_FIXTURE;
  else process.env.ROUND5C_SOURCE_FIXTURE = originalRawStore;
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type Fixture = {
  db: DatabaseSync;
  dataRoot: string;
  rawStore: string;
  abilitiesFile: string;
  selectedEntryId: string;
  authoredEntryId: string;
  selectedAbilityVersionId: number;
  selectedSourceHash: string;
};

function entriesAt(file: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
}

function writeEntries(file: string, entries: Array<Record<string, unknown>>): void {
  writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
}

const STAT_MECHANICS = {
  effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "M", operation: "add", value: 1 } },
  scope: { duration: "permanent" },
  behavior: "passive",
  trigger: null,
  usage: null,
  applies_to: null,
};

/** Record an approved compiled entry pinned to the source version's current leaves. */
function seedApprovedEntry(db: DatabaseSync, abilityVersionId: number, suffix: string, mechanics: Record<string, unknown> = STAT_MECHANICS): string {
  const batchId = `fixture-approval-${suffix}`;
  db.prepare("INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES (?, 'shape-approval', 'fixture-reviewer-secret', ?)")
    .run(batchId, "2026-01-01T00:00:00.000Z");
  const id = `compiled-${suffix}`;
  db.prepare(`
    INSERT INTO compiled_entries (id, ability_version_id, shape_signature, mechanics_json, inputs_hash, status, batch_id, created_at)
    VALUES (?, ?, 'EFFECT(characteristic-set)', ?, ?, 'approved', ?, ?)
  `).run(id, abilityVersionId, JSON.stringify(mechanics), compilationInputsHash(db, abilityVersionId), batchId, "2026-01-01T00:00:00.000Z");
  return id;
}

function buildFixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "round5c-publish-"));
  temporaryDirectories.push(directory);
  const dataRoot = join(directory, "data");
  cpSync(liveDataRoot, dataRoot, { recursive: true });
  const rawStore = join(directory, "raw-store");
  mkdirSync(rawStore, { recursive: true });
  process.env.ROUND5C_DATA_ROOT = dataRoot;
  process.env.ROUND5C_SOURCE_FIXTURE = rawStore;

  const abilitiesFile = join(dataRoot, "enrichment", factionId, "abilities.json");
  const originalEntries = entriesAt(abilitiesFile);
  const fixtureEntries = structuredClone(originalEntries);
  const selected = fixtureEntries.find((entry) => entry.ability_id === selectedAbilityId)!;
  // A valid effect the compiled entry replaces; the rest of the dataset must still validate
  // when only another entry is published.
  selected.effect = { type: "stat-modifier", target: "this-model", modifier: { stat: "M", operation: "add", value: 2 } };
  selected.behavior = "reactive";
  selected.community_notes = "metadata-must-survive";
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
  return {
    db,
    dataRoot,
    rawStore,
    abilitiesFile,
    selectedEntryId: seedApprovedEntry(db, selectedAbility.id, "selected"),
    authoredEntryId: seedApprovedEntry(db, authoredAbility.id, "authored"),
    selectedAbilityVersionId: selectedAbility.id,
    selectedSourceHash: selectedAbility.source_hash,
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
        entry_ids: [fixture.selectedEntryId],
      });
      expect(readFileSync(fixture.abilitiesFile, "utf8")).toBe(beforeText);
      expect(preview).toMatchObject({ faction_id: factionId, ability_ids: [selectedAbilityId] });
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
        effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "M", operation: "add", value: 1 } },
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

  it("replaces an authored effect once its shape is approved", async () => {
    const fixture = buildFixture();
    try {
      const before = entriesAt(fixture.abilitiesFile).find((entry) => entry.ability_id === authoredAbilityId)!;
      expect(before.effect).not.toEqual(STAT_MECHANICS.effect);
      const preview = await preparePublication(fixture.db, { faction_id: factionId, entry_ids: [fixture.authoredEntryId] });
      expect(preview.diff[0]!.fields.map((field) => field.field)).toContain("effect");
      await publishPublication(fixture.db, { batch_id: preview.batch_id, preview_hash: preview.preview_hash });
      const after = entriesAt(fixture.abilitiesFile).find((entry) => entry.ability_id === authoredAbilityId)!;
      expect(after).toMatchObject({ effect: STAT_MECHANICS.effect, name: before.name, source_digest: sourceDigest(authoredSourceText) });
    } finally {
      fixture.db.close();
    }
  }, 120_000);

  it("refuses every stale source, approval, leaf, schema, entity, preview, and validation gate", async () => {
    const fixture = buildFixture();
    const prepare = () => preparePublication(fixture.db, { faction_id: factionId, entry_ids: [fixture.selectedEntryId] });
    try {
      await expect(preparePublication(fixture.db, { faction_id: "necrons", entry_ids: [fixture.selectedEntryId] }))
        .rejects.toThrow(/belongs to faction adepta-sororitas/i);
      await expect(preparePublication(fixture.db, { faction_id: factionId, entry_ids: [fixture.selectedEntryId, fixture.selectedEntryId] }))
        .rejects.toThrow(/nonempty and unique/i);
      await expect(preparePublication(fixture.db, { faction_id: factionId, entry_ids: ["compiled-missing"] }))
        .rejects.toMatchObject({ status: 404 });

      const sourceFile = join(fixture.rawStore, `${factionId}.json`);
      const rawSource = readFileSync(sourceFile, "utf8");
      writeFileSync(sourceFile, rawSource.replace(privateSourceText, `${privateSourceText} Changed.`));
      await expect(prepare()).rejects.toThrow(/source changed after approval/i);
      const sourceRecords = JSON.parse(rawSource) as Array<Record<string, unknown>>;
      writeFileSync(sourceFile, JSON.stringify(sourceRecords.filter((entry) => entry.ability_id !== selectedAbilityId)));
      await expect(prepare()).rejects.toThrow(/fresh source is missing/i);
      const changedTypeRecords = JSON.parse(rawSource) as Array<Record<string, unknown>>;
      changedTypeRecords.find((entry) => entry.ability_id === selectedAbilityId)!.ability_type = "enhancement";
      writeFileSync(sourceFile, JSON.stringify(changedTypeRecords));
      await expect(prepare()).rejects.toThrow(/source changed after approval/i);
      writeFileSync(sourceFile, rawSource);

      fixture.db.prepare("UPDATE compiled_entries SET status = 'rejected' WHERE id = ?").run(fixture.selectedEntryId);
      await expect(prepare()).rejects.toThrow(/not an approved entry/i);
      fixture.db.prepare("UPDATE compiled_entries SET status = 'approved' WHERE id = ?").run(fixture.selectedEntryId);

      // A leaf decision after approval changes what the entry was compiled from.
      const phrase = "add one to this model's Move characteristic";
      const start = Buffer.byteLength(privateSourceText.slice(0, privateSourceText.indexOf(phrase)), "utf8");
      const leaf = applyAnnotationBatch(fixture.db, { reviewer: "fixture-reviewer", decisions: [{
        action: "confirm", ability_version_id: fixture.selectedAbilityVersionId, source_hash: fixture.selectedSourceHash,
        fragment: "RAW_TEXT", start_byte: start, end_byte: start + Buffer.byteLength(phrase, "utf8"), exact_text: phrase,
        role: "EFFECT", family_id: "characteristic-set", family_version: 2, parameters: { subject: "this-model", characteristic: "M", value: 1 },
      }] });
      await expect(prepare()).rejects.toThrow(/leaves changed after approval/i);
      fixture.db.prepare("UPDATE annotations SET status = 'retracted' WHERE batch_id = ?").run(leaf.batch_id);

      const valid = fixture.db.prepare("SELECT mechanics_json FROM compiled_entries WHERE id = ?").get(fixture.selectedEntryId) as { mechanics_json: string };
      fixture.db.prepare("UPDATE compiled_entries SET mechanics_json = ? WHERE id = ?")
        .run(JSON.stringify({ ...STAT_MECHANICS, effect: { type: "not-a-real-effect" } }), fixture.selectedEntryId);
      await expect(prepare()).rejects.toThrow(/fails the ability schema/i);
      fixture.db.prepare("UPDATE compiled_entries SET mechanics_json = ? WHERE id = ?").run(valid.mechanics_json, fixture.selectedEntryId);

      const originalFile = readFileSync(fixture.abilitiesFile, "utf8");
      writeEntries(fixture.abilitiesFile, entriesAt(fixture.abilitiesFile).filter((entry) => entry.ability_id !== selectedAbilityId));
      await expect(prepare()).rejects.toThrow(/missing from the destination/i);
      writeFileSync(fixture.abilitiesFile, originalFile);

      const preview = await prepare();
      await expect(publishPublication(fixture.db, { batch_id: preview.batch_id, preview_hash: "f".repeat(64) })).rejects.toThrow(/preview hash/i);
      writeFileSync(fixture.abilitiesFile, `${originalFile}\n`);
      await expect(publishPublication(fixture.db, { batch_id: preview.batch_id, preview_hash: preview.preview_hash })).rejects.toThrow(/preview is stale/i);
      writeFileSync(fixture.abilitiesFile, originalFile);

      const invalidInput = join(fixture.dataRoot, "core", "world-eaters", "units.json");
      const validInput = readFileSync(invalidInput, "utf8");
      writeFileSync(invalidInput, "not-json\n");
      await expect(prepare()).rejects.toThrow(/projected dataset fails validation/i);
      writeFileSync(invalidInput, validInput);
      expect(fixture.db.prepare("SELECT count(*) AS count FROM publication_batches").get()).toEqual({ count: 1 });
    } finally {
      fixture.db.close();
    }
  }, 180_000);

  it("marks a published batch stale once its entry's leaves change", async () => {
    const fixture = buildFixture();
    try {
      const preview = await preparePublication(fixture.db, { faction_id: factionId, entry_ids: [fixture.selectedEntryId] });
      await publishPublication(fixture.db, { batch_id: preview.batch_id, preview_hash: preview.preview_hash });
      expect(listPublications(fixture.db).items[0]).toMatchObject({ evidence_status: "current" });
      const phrase = "add one to this model's Move characteristic";
      const start = Buffer.byteLength(privateSourceText.slice(0, privateSourceText.indexOf(phrase)), "utf8");
      applyAnnotationBatch(fixture.db, { reviewer: "fixture-reviewer", decisions: [{
        action: "confirm", ability_version_id: fixture.selectedAbilityVersionId, source_hash: fixture.selectedSourceHash,
        fragment: "RAW_TEXT", start_byte: start, end_byte: start + Buffer.byteLength(phrase, "utf8"), exact_text: phrase,
        role: "EFFECT", family_id: "characteristic-set", family_version: 2, parameters: { subject: "this-model", characteristic: "M", value: 1 },
      }] });
      expect(listPublications(fixture.db).items[0]).toMatchObject({ evidence_status: "stale" });
      expect(getPublicationReport(fixture.db)).toMatchObject({ stale_published_abilities: [`${factionId}/${selectedAbilityId}`] });
    } finally {
      fixture.db.close();
    }
  }, 120_000);

  it("rejects a faction destination that resolves through a symlink outside the configured data root", async () => {
    const fixture = buildFixture();
    try {
      const factionDirectory = dirname(fixture.abilitiesFile);
      const outsideDirectory = join(dirname(fixture.dataRoot), "outside-faction");
      renameSync(factionDirectory, outsideDirectory);
      symlinkSync(outsideDirectory, factionDirectory, "dir");
      await expect(preparePublication(fixture.db, {
        faction_id: factionId,
        entry_ids: [fixture.selectedEntryId],
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
        entry_ids: [fixture.selectedEntryId],
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
