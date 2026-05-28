import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset } from "../src/data/dataset.js";
import { weaponKeywords, weapons } from "../src/data/index.js";

const CONFORMANCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../conformance/weapon-keywords",
);

describe("weapon-keyword catalog", () => {
  const ds = Dataset.embedded();

  it("ships the 11e canonical keyword set", () => {
    for (const id of [
      "lethal-hits",
      "sustained-hits",
      "devastating-wounds",
      "twin-linked",
      "rapid-fire",
      "heavy",
      "assault",
      "pistol",
      "torrent",
      "blast",
      "melta",
      "anti",
      "ignores-cover",
      "precision",
      "hazardous",
      "indirect-fire",
      "extra-attacks",
    ]) {
      expect(ds.weaponKeywords.get(id), `catalog missing keyword id ${id}`).toBeDefined();
    }
  });

  it("twin-linked resolves to a reroll-failed-wounds effect", () => {
    const twin = ds.weaponKeywords.get("twin-linked");
    expect(twin?.raw.effect).toEqual({
      type: "re-roll",
      target: "self",
      modifier: { roll: "wound", subset: "all-failures" },
    });
  });

  it("every weapon-profile keyword reference resolves against the catalog", () => {
    // The catalog is the data layer's contract for weapon keywords: any
    // unresolved keyword_id here means a weapon was authored against a
    // catalog entry that doesn't exist (or the catalog regressed).
    const unresolved: { weaponId: string; profileName: string; keywordId: string }[] = [];
    for (const view of weapons.all) {
      const weapon = view.raw;
      for (const profile of weapon.profiles) {
        for (const kw of profile.keywords ?? []) {
          if (!ds.weaponKeywords.get(kw.keyword_id)) {
            unresolved.push({
              weaponId: weapon.id,
              profileName: profile.name,
              keywordId: kw.keyword_id,
            });
          }
        }
      }
    }
    expect(unresolved, "unresolved keyword references").toEqual([]);
  });

  it("re-roll DSL effects on catalog entries carry a `subset`", () => {
    // Post-M0 invariant: every `re-roll` effect — wherever it lives — must
    // express its failure subset. The catalog is the smallest case to pin;
    // M0.5's migration ensures the same for the ability corpus.
    for (const kw of weaponKeywords.all) {
      walk(kw.raw.effect, (node) => {
        if (
          typeof node === "object" && node !== null &&
          (node as { type?: unknown }).type === "re-roll"
        ) {
          const mod = (node as { modifier?: unknown }).modifier;
          expect(mod, `${kw.id}.effect re-roll missing modifier`).toBeDefined();
          expect(
            (mod as { subset?: unknown }).subset,
            `${kw.id}.effect re-roll missing subset`,
          ).toBeDefined();
        }
      });
    }
  });
});

describe("weapon-keyword conformance golden", () => {
  const ds = Dataset.embedded();

  it("each case's expected effect matches the catalog", () => {
    const cases = JSON.parse(
      readFileSync(join(CONFORMANCE, "cases.json"), "utf-8"),
    ) as { keyword_id: string; expected_effect: unknown }[];
    expect(cases.length).toBeGreaterThan(0);
    for (const { keyword_id, expected_effect } of cases) {
      const entry = ds.weaponKeywords.get(keyword_id);
      expect(entry, `catalog missing ${keyword_id}`).toBeDefined();
      expect(entry!.raw.effect, `effect mismatch for ${keyword_id}`).toEqual(expected_effect);
    }
  });
});

function walk(node: unknown, visit: (n: unknown) => void): void {
  visit(node);
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) walk(value, visit);
  }
}
