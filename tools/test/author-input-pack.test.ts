import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { findAnchors, captureBody, type CardAnchor } from "../src/author-input-pack.js";
import type { Block } from "../src/pack-blocks.js";

// Two stratagem cards laid out side-by-side in two columns (the packs' real
// layout), plus a second card stacked below the left one. The bbox capture must
// keep each card's body to its own column AND stop at the next card down — the
// exact failure mode that made `pdftotext -layout` interleave the columns.
const LEFT_X = 50;
const RIGHT_X = 300; // > 46 apart → a different column

const blocks: Block[] = [
  // left column, card 1
  { x: LEFT_X, gy: 100, text: "DOMINANCE PROTOCOLS" },
  { x: LEFT_X, gy: 110, text: "DOMINANCE PROTOCOLS – BATTLE TACTIC STRATAGEM" },
  { x: LEFT_X, gy: 120, text: "WHEN: Your Command phase." },
  { x: LEFT_X, gy: 130, text: "EFFECT: left effect text only." },
  // right column, card 2 (same y band as card 1 — the interleave trap)
  { x: RIGHT_X, gy: 100, text: "WILL OF THE CONQUEROR" },
  { x: RIGHT_X, gy: 110, text: "WILL OF THE CONQUEROR – STRATEGIC PLOY STRATAGEM" },
  { x: RIGHT_X, gy: 120, text: "WHEN: Fight phase." },
  { x: RIGHT_X, gy: 130, text: "EFFECT: right effect text only." },
  // left column, card 3 (stacked below card 1)
  { x: LEFT_X, gy: 200, text: "NANOSATURATION" },
  { x: LEFT_X, gy: 210, text: "NANOSATURATION – EPIC DEED STRATAGEM" },
  { x: LEFT_X, gy: 220, text: "EFFECT: third card body." },
];

describe("findAnchors", () => {
  it("locates one anchor per stratagem card, keyed by slug", () => {
    const ids = findAnchors(blocks).map((a) => a.id).sort();
    expect(ids).toEqual(["dominance-protocols", "nanosaturation", "will-of-the-conqueror"]);
  });
});

describe("captureBody (column isolation)", () => {
  const anchors = findAnchors(blocks);
  const dominance = anchors.find((a) => a.id === "dominance-protocols") as CardAnchor;

  it("captures only the card's own column", () => {
    const body = captureBody(blocks, dominance, anchors);
    expect(body).toContain("left effect text only");
    expect(body).not.toContain("right effect text only");
    expect(body).not.toContain("WILL OF THE CONQUEROR");
  });

  it("stops at the next card down the same column", () => {
    const body = captureBody(blocks, dominance, anchors);
    expect(body).not.toContain("third card body");
    expect(body).not.toContain("NANOSATURATION");
  });

  it("includes the card's own WHEN/EFFECT prose below the name", () => {
    const body = captureBody(blocks, dominance, anchors);
    expect(body).toContain("WHEN: Your Command phase.");
  });
});

describe("faction pack CLI paths", () => {
  it("passes repository-relative single and directory PDF paths to pdftotext", () => {
    const root = join(import.meta.dirname, "../..");
    mkdirSync(join(root, "_private"), { recursive: true });
    const fixture = mkdtempSync(join(root, "_private", "pack-path-test-"));
    try {
      const stub = join(fixture, "pdftotext");
      writeFileSync(stub, "#!/bin/sh\nprintf '%s\\n' \"$@\" >&2\nexit 1\n");
      chmodSync(stub, 0o755);
      const pdf = join(fixture, "space-marines_faction_pack.pdf");
      writeFileSync(pdf, "");
      const relativeDir = `_private/${fixture.split("/").at(-1)!}`;
      const run = (args: string[]) => spawnSync("npx", ["tsx", "src/extract-faction-pack.ts", ...args], {
        cwd: join(root, "tools"),
        env: { ...process.env, PATH: `${fixture}:${process.env.PATH}` },
        encoding: "utf8",
      });
      for (const args of [[`${relativeDir}/space-marines_faction_pack.pdf`, "--faction", "fixture"], ["--all", "--dir", relativeDir], [pdf, "--faction", "fixture"]]) {
        const result = run(args);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(pdf);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
