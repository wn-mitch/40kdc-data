import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/families/index.js";
import { createValidator } from "../src/schema-loader.js";

/** The family versions the extensions under test create. */
const UNIT_POSITION_AND_REGION_VALUES_VERSIONS: ReadonlySet<string> = new Set(["unit-position@24"]);

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}
function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}
function errorsOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error("expected a refusal, but the leaves compiled");
  return result.errors.join("; ");
}

const REGION = { region_id: "the-shadow-of-chaos", owner_faction: "chaos-daemons" };
const AREA_TEXT = "The area around this model is held in the Zed zone.";
const areaLeaves = (side: string) => placed(AREA_TEXT,
  ["The area around this model", "unit-filter", { side }],
  ["around this model", "aura-range", { inches: 6, of: "this-model" }],
  ["is held in the Zed zone", "counts-as", { subject: "antecedent", region: REGION }]);


const validEffect = createValidator().compile({ $ref: "https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json#/$defs/effect-node" });

/** The version just before this extension of unit-position; later extensions may sit above it. */
const PREVIOUS = (() => {
  for (let version = currentFamilyVersion("unit-position"); version > 1; version -= 1) {
    const extension = familyExtension("unit-position", version);
    if (extension !== undefined && UNIT_POSITION_AND_REGION_VALUES_VERSIONS.has(`${extension.family}@${extension.version}`)) return version - 1;
  }
  throw new Error("The unit-position and region values extension is not registered.");
})();
const CURRENT = currentFamilyVersion("unit-position");
const normalize = (parameters: Record<string, unknown>, version = CURRENT) => normalizeFingerprintParameters("unit-position", parameters, version);
const WITHIN = { kind: "within", inches: 3, subject: "this-unit", negated: false };

describe("unit-position place values (family version)", () => {
  it("accepts a distance from the battlefield centre and refuses it one version earlier", () => {
    const leaf = { ...WITHIN, of: "battlefield-centre" };
    expect(normalize(leaf)).toEqual(leaf);
    expect(() => normalize(leaf, PREVIOUS)).toThrow();
    expect(normalize({ ...leaf, kind: "beyond" })).toMatchObject({ kind: "beyond", of: "battlefield-centre" });
  });

  it("refuses the centre for objective-range and closest-eligible", () => {
    expect(() => normalize({ kind: "objective-range", subject: "this-unit", negated: false, of: "battlefield-centre" })).toThrow();
    expect(() => normalize({ kind: "closest-eligible", subject: "this-unit", negated: false, of: "battlefield-centre" })).toThrow();
  });

  it("refuses a named range, a weapon distance or an every-model test against a place", () => {
    for (const extra of [{ range_ref: "contagion" }, { distance: "half-weapon" }, { weapon_range: "half" }, { models: "every" }]) {
      expect(() => normalize({ ...WITHIN, of: "battlefield-centre", ...extra })).toThrow();
      expect(() => normalize({ ...WITHIN, of: "enemy-deployment-zone", ...extra })).toThrow();
    }
  });

  it("accepts wholly within the enemy deployment zone, and keeps the beyond rule", () => {
    const leaf = { ...WITHIN, inches: 12, of: "enemy-deployment-zone", wholly: true };
    expect(normalize(leaf)).toEqual(leaf);
    expect(() => normalize(leaf, PREVIOUS)).toThrow();
    const { wholly: _wholly, ...plain } = leaf;
    expect(normalize(plain)).toEqual(plain);
    expect(() => normalize({ ...leaf, kind: "beyond" })).toThrow();
    expect(normalize({ ...WITHIN, kind: "beyond", of: "enemy-deployment-zone" })).toMatchObject({ kind: "beyond", of: "enemy-deployment-zone" });
    expect(normalize({ ...WITHIN, kind: "beyond", of: "enemy-deployment-zone" }, PREVIOUS)).toMatchObject({ kind: "beyond" });
  });

  it("refuses an objective marker's fields on the deployment zone", () => {
    expect(() => normalize({ ...WITHIN, of: "enemy-deployment-zone", objective_tag: "alpha-tag" })).toThrow();
    expect(() => normalize({ ...WITHIN, of: "enemy-deployment-zone", controlled_by: "you" })).toThrow();
  });

  it("accepts the event's object as the subject and refuses it for closest-eligible", () => {
    const leaf = { ...WITHIN, of: "this-model", subject: "event-object" };
    expect(normalize(leaf)).toEqual(leaf);
    expect(() => normalize(leaf, PREVIOUS)).toThrow();
    expect(normalize({ kind: "objective-range", subject: "event-object", controlled_by: "any", negated: false })).toMatchObject({ subject: "event-object" });
    expect(() => normalize({ kind: "closest-eligible", subject: "event-object", negated: false, to: "this-unit" })).toThrow();
  });

  it("keeps every authored value when two new values share one leaf", () => {
    const centre = { ...WITHIN, of: "battlefield-centre", subject: "event-object" };
    expect(normalize(centre)).toEqual(centre);
    const zone = { ...WITHIN, inches: 12, of: "enemy-deployment-zone", wholly: true, subject: "event-object" };
    expect(normalize(zone)).toEqual(zone);
  });

  it("still accepts every of and subject value the previous version accepted", () => {
    for (const of of ["this-unit", "this-model", "target", "attacker", "event-subject", "recipient", "selected-unit", "event-object", "antecedent", "battlefield-edge", "following-filter"]) {
      const leaf = { ...WITHIN, of };
      expect(normalize(leaf)).toEqual(normalize(leaf, PREVIOUS));
      expect(normalize(leaf)).toEqual(leaf);
    }
    for (const subject of ["this-unit", "this-model", "target", "attacker", "event-subject", "recipient", "selected-unit", "antecedent", "bearer-transport", "each-target"]) {
      const leaf = { kind: "objective-range", subject, controlled_by: "any", negated: false };
      expect(normalize(leaf)).toEqual(normalize(leaf, PREVIOUS));
    }
    const edge = { ...WITHIN, of: "battlefield-edge", wholly: true };
    expect(normalize(edge)).toEqual(edge);
    expect(normalize({ kind: "closest-eligible", subject: "target", negated: false, to: "this-unit", range: 6 })).toBeDefined();
  });
});

describe("unit-position place values (compile)", () => {
  it("lowers a distance from the centre of the battlefield of the event's object", () => {
    const text = "Just after an enemy unit selects targets, if that unit is within 3 of the centre, this model gains Zed.";
    const mechanics = mechanicsOf(placed(text,
      ["Just after an enemy unit selects targets", "event", { kind: "enemy-selected-targets" }],
      ["that unit is within 3 of the centre", "unit-position", { kind: "within", inches: 3, of: "battlefield-centre", subject: "event-object", negated: false }],
      ["this model gains Zed", "core-ability-grant", { subject: "this-model", ability: "benefit-of-cover" }]), text);
    expect(mechanics.effect.condition).toEqual({ type: "within", parameters: { subject: "event-object", of: "battlefield-centre", range: { inches: 3 } } });
    expect(validEffect(mechanics.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
  });

  it("keeps wholly on a distance from the centre and negates a beyond distance", () => {
    const text = "While this unit is wholly within 6 of the centre, it gains Zed.";
    const wholly = mechanicsOf(placed(text,
      ["While this unit is wholly within 6 of the centre", "unit-position", { kind: "within", inches: 6, wholly: true, of: "battlefield-centre", subject: "this-unit", negated: false }],
      ["it gains Zed", "core-ability-grant", { subject: "this-unit", ability: "benefit-of-cover" }]), text);
    expect(JSON.stringify(wholly.effect)).toContain('"of":"battlefield-centre","range":{"inches":6},"wholly":true');
    const beyond = mechanicsOf(placed(text,
      ["While this unit is wholly within 6 of the centre", "unit-position", { kind: "beyond", inches: 6, of: "battlefield-centre", subject: "this-unit", negated: false }],
      ["it gains Zed", "core-ability-grant", { subject: "this-unit", ability: "benefit-of-cover" }]), text);
    expect(JSON.stringify(beyond.effect)).toMatch(/"operator":"not".*"of":"battlefield-centre"/u);
  });

  it("lowers wholly within a distance of the enemy deployment zone with the wholly flag", () => {
    const text = "While this model is wholly within 12 of the far zone, it gains Zed.";
    const body = ["it gains Zed", "core-ability-grant", { subject: "this-model", ability: "benefit-of-cover" }] as [string, string, Record<string, unknown>];
    const position = (extra: Record<string, unknown>): [string, string, Record<string, unknown>] =>
      ["While this model is wholly within 12 of the far zone", "unit-position", { kind: "within", inches: 12, of: "enemy-deployment-zone", subject: "this-model", negated: false, ...extra }];
    const wholly = mechanicsOf(placed(text, position({ wholly: true }), body), text);
    expect(JSON.stringify(wholly.effect)).toContain('"subject":"this-model","of":{"territory":"enemy-deployment-zone"},"range":{"inches":12},"wholly":true');
    expect(validEffect(wholly.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
    const plain = mechanicsOf(placed(text, position({}), body), text);
    expect(JSON.stringify(plain.effect)).not.toContain('"wholly"');
  });

  const SET_UP = ["Set this unit up on the battlefield", "set-up", { subject: "this-unit", to: "battlefield" }] as [string, string, Record<string, unknown>];

  it("carries a set-up's distance from the centre into placement.near, never drops it", () => {
    const text = "Set this unit up on the battlefield within 9 of the centre.";
    const mechanics = mechanicsOf(placed(text, SET_UP,
      ["within 9 of the centre", "unit-position", { kind: "within", inches: 9, of: "battlefield-centre", subject: "antecedent", negated: false }]), text);
    expect(mechanics.effect.modifier.near).toEqual([{ of: "battlefield-centre", range: { inches: 9 } }]);
    expect(validEffect(mechanics.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
  });

  it("carries a set-up's wholly-within distance of the enemy deployment zone into placement.near, and the beyond form into away_from", () => {
    const text = "Set this unit up on the battlefield wholly within 9 of the far zone.";
    const near = mechanicsOf(placed(text, SET_UP,
      ["wholly within 9 of the far zone", "unit-position", { kind: "within", inches: 9, wholly: true, of: "enemy-deployment-zone", subject: "antecedent", negated: false }]), text);
    expect(near.effect.modifier.near).toEqual([{ of: { territory: "enemy-deployment-zone" }, range: { inches: 9 }, wholly: true }]);
    expect(validEffect(near.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
    const away = mechanicsOf(placed("Set this unit up on the battlefield more than 9 from the far zone.", SET_UP,
      ["more than 9 from the far zone", "unit-position", { kind: "beyond", inches: 9, of: "enemy-deployment-zone", subject: "antecedent", negated: false }]), "Set this unit up on the battlefield more than 9 from the far zone.");
    expect(away.effect.modifier.away_from).toEqual([{ of: { territory: "enemy-deployment-zone" }, range: { inches: 9 } }]);
    expect(away.effect.modifier.near).toBeUndefined();
  });
});

describe("an area held in a rule region reaches units of either side", () => {
  const REGION = { region_id: "the-zed-zone", owner_faction: "alpha-faction" };
  const TEXT = "The area around this model is held in the Zed zone.";
  const leaves = (side: string, body: [string, string, Record<string, unknown>] = ["is held in the Zed zone", "counts-as", { subject: "antecedent", region: REGION }]) => placed(TEXT,
    ["The area", "unit-filter", { side }],
    ["around this model", "aura-range", { inches: 6, of: "this-model" }],
    body);

  it("lowers to one counts-as over the units of either side within the range, not an aura or a sequence", () => {
    const mechanics = mechanicsOf(leaves("any"), TEXT);
    expect(mechanics.effect).toEqual({
      type: "counts-as",
      target: { owner: "any", within: { range: { inches: 6 }, of: "this-model" } },
      modifier: { in_region: { rule_region: REGION } },
    });
    expect(validEffect(mechanics.effect), JSON.stringify(validEffect.errors?.slice(0, 2))).toBe(true);
  });

  it("keeps wholly on the range", () => {
    const list = leaves("any");
    list[1] = { ...list[1]!, parameters: { ...list[1]!.parameters, wholly: true } };
    expect(mechanicsOf(list, TEXT).effect.target.within).toEqual({ range: { inches: 6 }, of: "this-model", wholly: true });
  });

  it("still refuses an aura over either side whose body is not a region grant", () => {
    const body: [string, string, Record<string, unknown>] = ["is held in the Zed zone", "characteristic-modifier", { subject: "antecedent", characteristic: "move", operation: "add", value: 1 }];
    expect(errorsOf(leaves("any", body), TEXT)).toMatch(/must say friendly or enemy/u);
  });

  it("still refuses either side for a model-level filter and a keyword-limited aura", () => {
    const model = placed(TEXT,
      ["The area", "unit-filter", { side: "any", level: "model" }],
      ["around this model", "aura-range", { inches: 6, of: "this-model" }],
      ["is held in the Zed zone", "counts-as", { subject: "antecedent", region: REGION }]);
    expect(errorsOf(model, TEXT)).toMatch(/must say friendly or enemy/u);
    const keyworded = placed(TEXT,
      ["The area", "unit-filter", { side: "any", keywords: ["ALPHA"] }],
      ["around this model", "aura-range", { inches: 6, of: "this-model" }],
      ["is held in the Zed zone", "counts-as", { subject: "antecedent", region: REGION }]);
    expect(errorsOf(keyworded, TEXT)).toMatch(/names no keyword/u);
  });

  it("compiles friendly and enemy auras as before", () => {
    const friendly = mechanicsOf(leaves("friendly"), TEXT);
    expect(friendly.effect).toMatchObject({ type: "aura", target: "friendly-within-aura", modifier: { range: 6, effect: { type: "counts-as" } } });
    const enemy = mechanicsOf(leaves("enemy"), TEXT);
    expect(enemy.effect).toMatchObject({ type: "aura", target: "enemy-within-aura" });
  });
});

describe("the round-6 overrides for a region grant", () => {
  it("give every counts-as in the Shadow of Chaos to units of either side", () => {
    const overrides = JSON.parse(readFileSync(new URL("../src/round6/vocab-overrides.json", import.meta.url), "utf8")) as unknown;
    const grants: Array<{ target?: { owner?: string } }> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node !== null && typeof node === "object") {
        const record = node as Record<string, any>;
        if (record.type === "counts-as" && record.modifier?.in_region?.rule_region?.region_id === "the-shadow-of-chaos") grants.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(overrides);
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) expect(grant.target?.owner).toBe("any");
  });
});
