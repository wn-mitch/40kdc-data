import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { hashJson } from "../src/round4/hash.js";
import { insertSpan, openWorkbench } from "../src/round5c/db.js";
import { loadSourceRecords, refreshSources } from "../src/round5c/source.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function store(records: unknown[]): string {
  const directory = mkdtempSync(join(tmpdir(), "round5c-store-"));
  directories.push(directory);
  writeFileSync(join(directory, "test-faction.json"), JSON.stringify(records));
  return directory;
}

describe("private source versioning", () => {
  it("keeps structured fragments byte-exact and rejects a cross-field span", () => {
    const directory = store([{ ability_id: "signal", when: "When café is chosen", effect: "Re-roll a Hit roll of 1." }]);
    const db = openWorkbench(":memory:");
    try {
      expect(refreshSources(db, directory).loaded).toBe(1);
      const row = db.prepare("SELECT id, source_text, source_hash, fragments_json FROM abilities WHERE current=1").get() as {
        id: number; source_text: string; source_hash: string; fragments_json: string;
      };
      const fragments = JSON.parse(row.fragments_json) as Array<{ fragment: string; start_byte: number; end_byte: number; text: string }>;
      expect(row.source_text).toBe("When café is chosen\nRe-roll a Hit roll of 1.");
      expect(row.source_hash).toBe(hashJson({ text: row.source_text }));
      expect(fragments.map(({ fragment, start_byte, end_byte }) => ({ fragment, start_byte, end_byte }))).toEqual([
        { fragment: "WHEN", start_byte: 0, end_byte: Buffer.byteLength("When café is chosen") },
        { fragment: "EFFECT", start_byte: Buffer.byteLength("When café is chosen\n"), end_byte: Buffer.byteLength(row.source_text) },
      ]);
      const effect = fragments[1];
      expect(insertSpan(db, row.id, "EFFECT", effect.start_byte, effect.end_byte, effect.text)).toBeGreaterThan(0);
      expect(() => insertSpan(db, row.id, "WHEN", 0, effect.end_byte, row.source_text)).toThrow(/fragment/i);
      expect(() => insertSpan(db, row.id, "WHEN", 9, 10, "é")).toThrow(/UTF-8|match/i);
    } finally {
      db.close();
    }
  });

  it("reports a conflicting identity rather than choosing one source", () => {
    const directory = store([
      { id: "same", raw_text: "Gain a point." },
      { id: "same", raw_text: "Lose a point." },
      { id: "empty", raw_text: "  " },
    ]);
    const loaded = loadSourceRecords(directory);
    expect(loaded.records).toEqual([]);
    expect(loaded.conflicts).toEqual([expect.objectContaining({ factionId: "test-faction", abilityId: "same" })]);
    expect(loaded.skipped).toEqual([expect.objectContaining({ abilityId: "empty", reason: "missing-prose" })]);
  });

  it("does not silently reinterpret offsets when a text-identical record changes fragment layout", () => {
    const directory = store([{ id: "signal", raw_text: "Before\nAfter", name: "First name" }]);
    const db = openWorkbench(":memory:");
    try {
      refreshSources(db, directory);
      const current = db.prepare("SELECT id, name FROM abilities WHERE current=1").get() as { id: number; name: string };
      writeFileSync(join(directory, "test-faction.json"), JSON.stringify([
        { id: "signal", when: "Before", effect: "After" },
      ]));
      expect(() => refreshSources(db, directory)).toThrow(/fragment boundaries changed/);
      expect(db.prepare("SELECT id, name FROM abilities WHERE current=1").get()).toEqual(current);
      writeFileSync(join(directory, "test-faction.json"), JSON.stringify([
        { id: "signal", raw_text: "Before\nAfter", name: "Updated name" },
      ]));
      expect(refreshSources(db, directory).retained).toBe(1);
      expect(db.prepare("SELECT name FROM abilities WHERE id=?").get(current.id)).toEqual({ name: "Updated name" });
    } finally {
      db.close();
    }
  });

  it("quarantines annotations when the current source hash changes", () => {
    const directory = store([{ id: "signal", raw_text: "Re-roll a Hit roll of 1." }]);
    const db = openWorkbench(":memory:");
    try {
      refreshSources(db, directory);
      const first = db.prepare("SELECT id, source_hash FROM abilities WHERE current=1").get() as { id: number; source_hash: string };
      const annotationSpan = insertSpan(db, first.id, "RAW_TEXT", 0, 7, "Re-roll");
      expect(annotationSpan).toBeGreaterThan(0);
      writeFileSync(join(directory, "test-faction.json"), JSON.stringify([{ id: "signal", raw_text: "Add 1 to a Hit roll." }]));
      expect(refreshSources(db, directory).inserted).toBe(1);
      const current = db.prepare("SELECT id, source_hash FROM abilities WHERE current=1").get() as { id: number; source_hash: string };
      expect(current.id).not.toBe(first.id);
      expect(current.source_hash).not.toBe(first.source_hash);
      expect(db.prepare("SELECT ability_version_id FROM source_spans WHERE id=?").get(annotationSpan)).toEqual({ ability_version_id: first.id });
    } finally {
      db.close();
    }
  });
});
