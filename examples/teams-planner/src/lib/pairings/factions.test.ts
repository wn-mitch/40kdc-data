/**
 * Manifest integrity: every faction the pairing mat can show — the archetype
 * pool's factions plus every dataset faction with detachments — must resolve
 * to a style whose icon file actually exists in public/faction-icons.
 * Enumerated with Vite's import.meta.glob so the test stays free of node
 * builtins (no @types/node in this workspace).
 */
import { describe, expect, it } from "vitest";
import { ds } from "../dataset";
import { ARCHETYPE_POOL } from "./archetype-pool";
import { factionStyle, NEUTRAL_STYLE } from "./factions";

/** Basenames of every committed icon (glob keys are /public-rooted paths). */
const ICON_FILES = new Set(
  Object.keys(import.meta.glob("/public/faction-icons/*.svg")).map((p) => p.split("/").pop()!),
);

function iconFile(style: { icon: string }): string {
  return style.icon.split("/").pop()!;
}

describe("faction style manifest", () => {
  const factionIds = [
    ...new Set([
      ...ARCHETYPE_POOL.map((a) => a.factionId),
      ...ds.factions.all.filter((f) => ds.detachments.byFaction(f.id).length > 0).map((f) => f.id),
    ]),
  ];

  it("covers every pool + dataset faction with a non-neutral style", () => {
    for (const id of factionIds) {
      const style = factionStyle(id);
      expect(style, id).not.toBe(NEUTRAL_STYLE);
    }
  });

  it("every resolved icon file exists on disk", () => {
    expect(ICON_FILES.size).toBeGreaterThan(0);
    for (const id of factionIds) {
      expect(ICON_FILES.has(iconFile(factionStyle(id))), `${id} → ${factionStyle(id).icon}`).toBe(
        true,
      );
    }
  });

  it("accent and body colors are well-formed hexes", () => {
    for (const id of factionIds) {
      const { color, colorDim } = factionStyle(id);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(colorDim).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("unknown and null ids fall back to neutral", () => {
    expect(factionStyle("not-a-faction")).toBe(NEUTRAL_STYLE);
    expect(factionStyle(null)).toBe(NEUTRAL_STYLE);
  });
});
