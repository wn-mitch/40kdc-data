import { describe, expect, it } from "vitest";

import { bareName, buildIdentities, ratingFromTail, splitRating, suffixed } from "../src/mfm/mirror/identity.js";
import { editArray, editObjectKeys } from "../src/mfm/mirror/json-edit.js";
import type { AbilityRow } from "../src/mfm/dump-prose-rows.js";
import { matchName } from "../src/mfm/mirror/names.js";
import { findRefs } from "../src/mfm/mirror/refs.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";
import { abilityIdsOf, printedWargearIds, withRating } from "../src/data/ability-refs.js";
import { ratingValue } from "../src/mfm/mirror/units.js";
import { describeAbility } from "../src/translate/effect.js";

describe("mirror identity helpers", () => {
  it("suffixes once and never doubles a faction already named at the end", () => {
    expect(suffixed("grudge-engine", "orks")).toBe("grudge-engine-orks");
    expect(suffixed("grudge-engine-orks", "orks")).toBe("grudge-engine-orks");
    expect(suffixed("lord-of-the-death-guard", "death-guard")).toBe("lord-of-the-death-guard");
    // A faction name inside the id (not at its end) is not a suffix.
    expect(suffixed("death-guard-veteran", "death-guard")).toBe("death-guard-veteran-death-guard");
    expect(suffixed("deep-strike", "_core")).toBe("deep-strike");
  });

  it("splits a core rating from the rule name, and only a rating", () => {
    expect(splitRating("Deadly Demise D6+2")).toEqual({ base: "Deadly Demise", rating: "D6+2" });
    expect(splitRating("Deadly Demise 2D6")).toEqual({ base: "Deadly Demise", rating: "2D6" });
    expect(splitRating("Feel No Pain 5+")).toEqual({ base: "Feel No Pain", rating: "5+" });
    expect(splitRating('Scouts 9"')).toEqual({ base: "Scouts", rating: '9"' });
    expect(splitRating("Firing Deck 11")).toEqual({ base: "Firing Deck", rating: "11" });
    expect(splitRating("Super-heavy Walker")).toEqual({ base: "Super-heavy Walker" });
    expect(splitRating("Lone Operative")).toEqual({ base: "Lone Operative" });
  });

  it("drops a trailing qualifier from the printed name", () => {
    expect(bareName("Executioner of Heretics (Aura)")).toBe("Executioner of Heretics");
    expect(bareName("Symphonic Payload (Upgrade)")).toBe("Symphonic Payload");
    expect(bareName("Blessing (Once per battle, per unit)")).toBe("Blessing");
    expect(bareName("(Aura)")).toBe("(Aura)");
  });
});

describe("mirror JSON edits", () => {
  const file = `[\n  {\n    "id": "a",\n    "list": ["x", "y"]\n  },\n  {\n    "id": "b",\n    "name": "Caf\\u00e9"\n  },\n  {\n    "id": "c"\n  }\n]\n`;

  it("removes, replaces and appends without touching other bytes", () => {
    const out = editArray(file, { remove: new Set([1]), replace: new Map([[0, [{ path: ["list"], value: ["z"] }]]]), append: [{ id: "d", tags: ["t"] }] });
    expect(out).toBe(`[\n  {\n    "id": "a",\n    "list": ["z"]\n  },\n  {\n    "id": "c"\n  },\n  {\n    "id": "d",\n    "tags": [\n      "t"\n    ]\n  }\n]\n`);
  });

  it("returns the text unchanged for an empty edit and [] when everything goes", () => {
    expect(editArray(file, {})).toBe(file);
    expect(editArray(file, { remove: new Set([0, 1, 2]) })).toBe("[]\n");
    expect(editArray("[]\n", { append: [{ id: "n" }] })).toBe(`[\n  {\n    "id": "n"\n  }\n]\n`);
  });

  it("inserts a missing top-level key after the last member, leaving the element's other bytes alone", () => {
    const out = editArray(file, { replace: new Map([[0, [{ path: ["faction_id"], value: "orks" }]]]) });
    expect(out).toBe(file.replace('"list": ["x", "y"]\n  }', '"list": ["x", "y"],\n    "faction_id": "orks"\n  }'));
  });

  it("adds a nested key an element lacks by rewriting only that element", () => {
    const out = editArray(file, { replace: new Map([[2, [{ path: ["meta", "k"], value: ["q"] }]]]) });
    expect(JSON.parse(out)[2]).toEqual({ id: "c", meta: { k: ["q"] } });
    expect(out.startsWith(file.slice(0, file.indexOf('"id": "c"')))).toBe(true);
  });

  it("keeps a file's \\u escapes when it writes non-ASCII that way", () => {
    const escaped = `[\n  {\n    "name": "Caf\\u00e9"\n  }\n]\n`;
    const out = editArray(escaped, { replace: new Map([[0, [{ path: ["name"], value: "Thé" }]]]) });
    expect(out).toContain("Th\\u00e9");
  });

  it("renames and drops object keys, keeping values byte-for-byte", () => {
    const obj = `{\n  "k1": { "a": 1 },\n  "k2": [1,2],\n  "k3": "v"\n}\n`;
    expect(editObjectKeys(obj, new Map([["k1", "n1"], ["k3", null]]))).toBe(`{\n  "n1": { "a": 1 },\n  "k2": [1,2]\n}\n`);
  });
});

describe("mirror reference finder", () => {
  it("finds ability refs by shape and skips core-rule and keyword rule-states", () => {
    const refs = findRefs({
      steps: [
        { type: "ability-grant", modifier: { ability: "a1" } },
        { type: "rule-state", modifier: { rule_kind: "ability", rule: "a2" } },
        { type: "rule-state", modifier: { rule_kind: "core-rule", rule: "fire-overwatch" } },
        { type: "rule-state", modifier: { rule_kind: "keyword", rule: "fly" } },
        { type: "rule-active", parameters: { rule: "a3" } },
        { trigger: { source_ability: { ability_id: "a4", owner: "friendly" } } },
        { type: "happened", parameters: { of: "ability", id: "a5" } },
        { type: "permission", modifier: { stratagem: "s1" } },
        { range: { aura_of: "a6" } },
      ],
    });
    expect(refs.map((r) => `${r.kind}:${r.value}`).sort()).toEqual(["ability:a1", "ability:a2", "ability:a3", "ability:a4", "ability:a5", "ability:a6", "stratagem:s1"]);
  });
});

describe("mirror name matching", () => {
  const row = (key: string, name: string) => ({ key, name, kind: "datasheet-ability" }) as AbilityRow;

  it("lets a qualified and an unqualified printing of one name compete", () => {
    const m = matchName([row("a", "Force Edge (Psychic)"), row("b", "Force Edge"), row("c", "Force Wall")], "force-edge-psychic");
    expect(m?.rows.map((r) => r.key).sort()).toEqual(["a", "b"]);
  });

  it("takes the dump's spelling only when no exact form matches", () => {
    expect(matchName([row("a", "Counteroffensive")], "counter-offensive")).toMatchObject({ tier: "spelling" });
    expect(matchName([row("a", "Counteroffensive"), row("b", "Counter-offensive")], "counter-offensive")?.rows.map((r) => r.key)).toEqual(["b"]);
  });
});

describe("mirror identity ids", () => {
  const row = (key: string, kind: AbilityRow["kind"], name: string, owner: AbilityRow["owner"]) =>
    ({ key, kind, name, owner, faction: "orks", table: "x", rowId: key, ref: key, slug: null, text: key, publication: null, legends: false, sharedWith: [] }) as unknown as AbilityRow;

  it("keeps an enhancement's printed tag in its id but drops a datasheet rule's qualifier", () => {
    const det = { kind: "detachment", id: "d1", name: "Iron Host", slug: "iron-host" } as const;
    const ds = { kind: "datasheet", id: "s1", name: "Boss", slug: "boss" } as const;
    const ids = buildIdentities({ rows: [row("e", "enhancement", "Star Lantern (Upgrade)", det), row("a", "datasheet-ability", "Ward (Aura)", ds)], unowned: [] });
    expect(ids.identities.map((i) => i.id).sort()).toEqual(["star-lantern-upgrade-iron-host-orks", "ward-orks"]);
  });
});

// One _core record per rated rule reads the rating the unit prints ({rating: true}).
const fnp = { type: "feel-no-pain", target: "this-unit", modifier: { threshold: { rating: true } } };
const scouts = { type: "ability-grant", target: "this-unit", modifier: { ability: "scouts", value: { rating: true } } };
const demise = { type: "mortal-wounds", target: { owner: "enemy" }, modifier: { count: { rating: true } } };
const source = { kind: "ability", abilityId: "feel-no-pain", abilityKind: "unit" } as const;

describe("rated core rules", () => {
  it("substitutes the unit's rating everywhere {rating: true} stands, and nothing else", () => {
    expect(withRating(fnp, 5)).toEqual({ ...fnp, modifier: { threshold: 5 } });
    expect(withRating(demise, "D3")).toEqual({ ...demise, modifier: { count: "D3" } });
    expect(withRating(fnp, undefined)).toBe(fnp);
    const untouched = { type: "x", modifier: { rating: true, other: 1 } };
    expect(withRating(untouched, 4)).toBe(untouched);
  });

  it("describes the rating as X without a unit, and the printed value with one", () => {
    expect(describeAbility({ effect: fnp as never })).toContain("Feel No Pain X+ ability, X being its rating");
    expect(describeAbility({ effect: withRating(fnp, 5) as never })).toContain("Feel No Pain 5+ ability");
    expect(describeAbility({ effect: scouts as never })).toContain('Scouts X" ability, X being its rating');
    expect(describeAbility({ effect: demise as never })).toContain("equal to its rating");
    expect(describeAbility({ effect: withRating(demise, "D3") as never })).toContain("D3 mortal wounds");
  });

  it("gives the cruncher the unit's Feel No Pain threshold", () => {
    const rated = effectToBuffs(withRating(fnp, 5), source, { phase: "shooting" }, "target");
    expect(rated.applied.map((b) => b.contribution)).toEqual([{ type: "feel-no-pain", threshold: 5 }]);
    // Without a unit there is no threshold to apply: surfaced, not guessed.
    const bare = effectToBuffs(fnp, source, { phase: "shooting" }, "target");
    expect(bare.applied).toEqual([]);
    expect(bare.unsupported.map((u) => u.reason)).toContain("feel-no-pain: threshold not numeric");
  });

  it("stores ratings as the unit schema reads them", () => {
    expect(ratingValue("5+")).toBe(5);
    expect(ratingValue('9"')).toBe(9);
    expect(ratingValue("12")).toBe(12);
    expect(ratingValue("D6+2")).toBe("D6+2");
    expect(ratingFromTail("5-plus")).toBe(5);
    expect(ratingFromTail("d6-plus-2")).toBe("D6+2");
    expect(ratingFromTail("d6-3")).toBe("D6+3");
    expect(ratingFromTail("2d6")).toBe("2D6");
    expect(ratingFromTail("d6-3-szarekh-model-only")).toBeNull();
  });

  it("reads both forms of a unit's ability_ids entry", () => {
    const refs = ["a", { id: "feel-no-pain", value: 5 }, { id: "serpent-shield-aeldari", wargear: "serpent-shield" }, 7, null];
    expect(abilityIdsOf(refs)).toEqual(["a", "feel-no-pain", "serpent-shield-aeldari"]);
    expect(printedWargearIds(refs)).toEqual(["serpent-shield"]);
  });
});
