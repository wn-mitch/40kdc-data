/**
 * Manifest integrity: every faction the pairing mat can show — the archetype
 * pool's factions plus every dataset faction with detachments — must resolve
 * to a style whose icon file actually exists in public/faction-icons. Runs
 * node-side so it can stat the files (same pattern as the pool-integrity
 * test resolving against the embedded dataset).
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ds } from "../dataset";
import { ARCHETYPE_POOL } from "./archetype-pool";
import { factionStyle, NEUTRAL_STYLE } from "./factions";

const ICONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/faction-icons");

function iconPath(style: { icon: string }): string {
  return resolve(ICONS_DIR, style.icon.split("/").pop()!);
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
    for (const id of factionIds) {
      expect(existsSync(iconPath(factionStyle(id))), `${id} → ${factionStyle(id).icon}`).toBe(true);
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
