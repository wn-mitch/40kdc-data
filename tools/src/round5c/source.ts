import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { assembleStoreSource, type StoreSourceFragment } from "../mfm/store-source.js";
import { hashJson } from "../round4/hash.js";
import { bumpWorkbenchRevision, initializeWorkbench, invalidateAbilityEvidence, withTransaction } from "./db.js";
import { reconcileWorkbench } from "./stamps.js";
import { proposeLexical } from "./retrieval.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultStorePath = process.env.RAW_TEXT_STORE ?? resolve(repositoryRoot, "../40kdc-abilities");

export type SourceRecord = {
  factionId: string;
  abilityId: string;
  sourceHash: string;
  text: string;
  fragments: StoreSourceFragment[];
  sourceType: string | null;
  sourceKind: string | null;
  name: string | null;
  metadata: Record<string, unknown>;
};

export type SkippedSourceRecord = {
  file: string;
  row: number | null;
  reason: "invalid-json" | "non-array" | "invalid-record" | "missing-identity" | "missing-prose" | "duplicate-identical";
  factionId?: string;
  abilityId?: string;
};

export type SourceConflict = {
  factionId: string;
  abilityId: string;
  sourceHashes: string[];
  locations: Array<{ file: string; row: number }>;
};

export type SourceLoadReport = {
  storePath: string;
  records: SourceRecord[];
  skipped: SkippedSourceRecord[];
  conflicts: SourceConflict[];
};

export type SourceRefreshReport = {
  storePath: string;
  loaded: number;
  inserted: number;
  retained: number;
  reactivated: number;
  retired: number;
  chunksBuilt: number;
  skipped: SkippedSourceRecord[];
  conflicts: SourceConflict[];
};

type PendingRecord = SourceRecord & { file: string; row: number };

function identifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceKind(entry: Record<string, unknown>): string | null {
  const source = entry.source;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
  return textField((source as Record<string, unknown>).kind);
}

function sourceMetadata(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    game_version: entry.game_version ?? null,
    source: entry.source ?? null,
  };
}

function identityKey(factionId: string, abilityId: string): string {
  return `${factionId}\u0000${abilityId}`;
}

/**
 * Read faction-array source files directly from the sibling store.
 *
 * `index.json` is deliberately ignored: it is a flattened convenience index
 * and does not preserve the authoritative faction-local metadata or bytes.
 */
export function loadSourceRecords(storePath = defaultStorePath): SourceLoadReport {
  const skipped: SkippedSourceRecord[] = [];
  const conflicts: SourceConflict[] = [];
  const candidates = new Map<string, PendingRecord>();
  const conflictByIdentity = new Set<string>();
  const files = readdirSync(storePath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json")
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    const sourcePath = resolve(storePath, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(sourcePath, "utf8"));
    } catch {
      skipped.push({ file, row: null, reason: "invalid-json" });
      continue;
    }
    if (!Array.isArray(parsed)) {
      skipped.push({ file, row: null, reason: "non-array" });
      continue;
    }

    const filenameFaction = basename(file, ".json");
    for (const [index, value] of parsed.entries()) {
      const row = index + 1;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        skipped.push({ file, row, reason: "invalid-record" });
        continue;
      }
      const entry = value as Record<string, unknown>;
      const factionId = identifier(entry.faction_id) ?? filenameFaction;
      const abilityId = identifier(entry.ability_id) ?? identifier(entry.id);
      if (!factionId || !abilityId) {
        skipped.push({ file, row, reason: "missing-identity", factionId: factionId ?? undefined });
        continue;
      }

      const assembled = assembleStoreSource(entry);
      if (!assembled) {
        skipped.push({ file, row, reason: "missing-prose", factionId, abilityId });
        continue;
      }
      const record: PendingRecord = {
        file,
        row,
        factionId,
        abilityId,
        sourceHash: hashJson({ text: assembled.text }),
        text: assembled.text,
        fragments: assembled.fragments,
        sourceType: textField(entry.ability_type),
        sourceKind: sourceKind(entry),
        name: textField(entry.name),
        metadata: sourceMetadata(entry),
      };
      const key = identityKey(factionId, abilityId);
      if (conflictByIdentity.has(key)) {
        const conflict = conflicts.find((item) => item.factionId === factionId && item.abilityId === abilityId);
        if (conflict) {
          if (!conflict.sourceHashes.includes(record.sourceHash)) conflict.sourceHashes.push(record.sourceHash);
          conflict.locations.push({ file, row });
        }
        continue;
      }

      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, record);
        continue;
      }
      if (existing.sourceHash === record.sourceHash) {
        skipped.push({ file, row, reason: "duplicate-identical", factionId, abilityId });
        continue;
      }

      candidates.delete(key);
      conflictByIdentity.add(key);
      conflicts.push({
        factionId,
        abilityId,
        sourceHashes: [existing.sourceHash, record.sourceHash],
        locations: [
          { file: existing.file, row: existing.row },
          { file, row },
        ],
      });
    }
  }

  const records = [...candidates.values()]
    .sort((left, right) => identityKey(left.factionId, left.abilityId).localeCompare(identityKey(right.factionId, right.abilityId)))
    .map(({ file: _file, row: _row, ...record }) => record);
  return { storePath, records, skipped, conflicts };
}

function normalizeSourceText(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

function contextKey(normalizedText: string): string {
  const tokens = normalizedText.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.slice(0, 12).join(" ") || normalizedText;
}

type SourceChunk = {
  fragment: string;
  startByte: number;
  endByte: number;
  normalizedText: string;
  contextKey: string;
};

function chunksForFragment(fragment: StoreSourceFragment): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  const text = fragment.text;
  let start = 0;
  const boundaries = /[.!?;:]+(?:\s+|$)|\n+/gu;

  const appendChunk = (end: number): void => {
    const selected = text.slice(start, end);
    const leading = selected.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = selected.match(/\s*$/u)?.[0].length ?? 0;
    const chunkStart = start + leading;
    const chunkEnd = end - trailing;
    if (chunkEnd <= chunkStart) return;
    const chunkText = text.slice(chunkStart, chunkEnd);
    const normalizedText = normalizeSourceText(chunkText);
    if (!normalizedText) return;
    chunks.push({
      fragment: fragment.fragment,
      startByte: fragment.start_byte + Buffer.byteLength(text.slice(0, chunkStart)),
      endByte: fragment.start_byte + Buffer.byteLength(text.slice(0, chunkEnd)),
      normalizedText,
      contextKey: contextKey(normalizedText),
    });
  };

  for (const match of text.matchAll(boundaries)) {
    const matched = match[0];
    const terminal = matched.replace(/\s+$/u, "");
    const end = (match.index ?? 0) + terminal.length;
    appendChunk(end);
    start = (match.index ?? 0) + matched.length;
  }
  appendChunk(text.length);
  return chunks;
}


/** Refresh current source-version pointers while retaining historical rows and spans. */
export function refreshSources(db: DatabaseSync, storePath = defaultStorePath): SourceRefreshReport {
  initializeWorkbench(db);
  const loaded = loadSourceRecords(storePath);

  return withTransaction(db, () => {
    const currentRows = db.prepare("SELECT id FROM abilities WHERE current = 1").all() as Array<{ id: number }>;
    const previousCurrent = new Set(currentRows.map((row) => row.id));
    const clearCurrent = db.prepare("UPDATE abilities SET current = 0 WHERE current = 1");
    const findVersion = db.prepare(
      "SELECT id, fragments_json FROM abilities WHERE faction_id = ? AND ability_id = ? AND source_hash = ?",
    );
    const insertVersion = db.prepare(
      "INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    );
    const updateMetadata = db.prepare(
      "UPDATE abilities SET source_type = ?, source_kind = ?, name = ?, metadata_json = ? WHERE id = ?",
    );
    const setCurrent = db.prepare("UPDATE abilities SET current = 1 WHERE id = ?");
    const countChunks = db.prepare("SELECT count(*) AS total FROM source_chunks WHERE ability_version_id = ?");
    const insertChunk = db.prepare(
      "INSERT INTO source_chunks (ability_version_id, fragment, start_byte, end_byte, normalized_text, context_key) VALUES (?, ?, ?, ?, ?, ?)",
    );
    let inserted = 0;
    let retained = 0;
    let reactivated = 0;
    let preservedCurrent = 0;
    let chunksBuilt = 0;
    const currentVersionIds = new Set<number>();

    {
      clearCurrent.run();
      for (const record of loaded.records) {
        const existing = findVersion.get(record.factionId, record.abilityId, record.sourceHash) as { id: number; fragments_json: string } | undefined;
        let abilityVersionId: number;
        if (existing) {
          abilityVersionId = existing.id;
          if (JSON.stringify(JSON.parse(existing.fragments_json)) !== JSON.stringify(record.fragments)) {
            throw new Error(`Source fragment boundaries changed without a text hash change for ${record.factionId}/${record.abilityId}. Review the source layout before refreshing.`);
          }
          updateMetadata.run(record.sourceType, record.sourceKind, record.name, JSON.stringify(record.metadata), abilityVersionId);
          if (previousCurrent.has(abilityVersionId)) {
            retained += 1;
            preservedCurrent += 1;
          } else {
            reactivated += 1;
          }
          setCurrent.run(abilityVersionId);
        } else {
          const result = insertVersion.run(
            record.factionId,
            record.abilityId,
            record.sourceHash,
            record.text,
            record.sourceType,
            record.sourceKind,
            record.name,
            JSON.stringify(record.metadata),
            JSON.stringify(record.fragments),
          );
          abilityVersionId = Number(result.lastInsertRowid);
          inserted += 1;
        }
        currentVersionIds.add(abilityVersionId);

        const chunkCount = countChunks.get(abilityVersionId) as { total: number };
        if (chunkCount.total > 0) continue;
        for (const fragment of record.fragments) {
          for (const chunk of chunksForFragment(fragment)) {
            insertChunk.run(
              abilityVersionId,
              chunk.fragment,
              chunk.startByte,
              chunk.endByte,
              chunk.normalizedText,
              chunk.contextKey,
            );
            chunksBuilt += 1;
          }
        }
      }
    }
    const retiredVersionIds = [...previousCurrent].filter((abilityVersionId) => !currentVersionIds.has(abilityVersionId));
    invalidateAbilityEvidence(db, retiredVersionIds, "SOURCE_VERSION_RETIRED");
    const reconciliation = reconcileWorkbench(db, {
      ability_version_ids: [...currentVersionIds],
      refresh_lexical: () => proposeLexical(db),
      bump_revision: false,
    });
    if (inserted > 0 || reactivated > 0 || retiredVersionIds.length > 0 || chunksBuilt > 0 || reconciliation.changed) {
      bumpWorkbenchRevision(db);
    }

    return {
      storePath: loaded.storePath,
      loaded: loaded.records.length,
      inserted,
      retained,
      reactivated,
      retired: previousCurrent.size - preservedCurrent,
      chunksBuilt,
      skipped: loaded.skipped,
      conflicts: loaded.conflicts,
    };
  });
}
