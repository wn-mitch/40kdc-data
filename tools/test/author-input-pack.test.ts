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
