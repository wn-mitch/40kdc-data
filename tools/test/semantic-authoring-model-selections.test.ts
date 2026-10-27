import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { familyExtension } from "../src/semantic-authoring/families/index.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
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

const TEXT = "In your Command phase, select one friendly ALPHA model. Each model can only be selected for this ability once per turn. The selected model adds 1 to its Hit roll.";
const SELECT: Item[] = [
  ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
  ["select one", "select-unit", { distance: "any", visible: false }],
  ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
  ["The selected model adds 1 to its Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
];

/** The selection items with one usage placed where its sentence falls in TEXT. */
const withUsage = (usage: Item): Item[] => [SELECT[0]!, SELECT[1]!, SELECT[2]!, usage, SELECT[3]!];

function resultOf(items: Item[], text = TEXT, abilityId?: string) {
  return compileLeaves(placed(text, ...items), text, { abilityId });
}

/** The selection node in the compiled effect: the select-units whose selector targets a model. */
function selectorOf(mechanics: Record<string, any>): Record<string, any> {
  const find = (node: unknown): Record<string, any> | undefined => {
    if (node === null || typeof node !== "object") return undefined;
    if (Array.isArray(node)) return node.map(find).find((hit) => hit !== undefined);
    const record = node as Record<string, any>;
    if (record.type === "select-units") return record.selector;
    return Object.values(record).map(find).find((hit) => hit !== undefined);
  };
  const selector = find(mechanics.effect);
  if (selector === undefined) throw new Error("no select-units in the effect");
  return selector;
}

describe("Semantic authoring per-model usage as the selection's limit", () => {
  it("lowers a once-per-turn per-model usage to limit on the model selection", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mechanics = result.mechanics as unknown as Record<string, any>;
    expect(selectorOf(mechanics)).toMatchObject({ filter: { level: "model" }, limit: { count: 1, period: "turn" } });
    // The cap belongs to each selected model, not to the ability's usage.
    expect(mechanics.usage).toBeUndefined();
  });

  it("maps once-per-battle to a battle period of one", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-battle", per: "model" }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>).limit).toEqual({ count: 1, period: "battle" });
  });

  it("maps once-per-command-phase to a phase period when the window is the Command phase", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-command-phase", per: "model" }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>).limit).toEqual({ count: 1, period: "phase" });
  });

  it("refuses once-per-command-phase when the ability's window is another phase", () => {
    const result = resultOf([["In your Command phase", "phase-window", { phase: "shooting", turn: "your" }], ...withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-command-phase", per: "model" }]).slice(1)]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/Command phase/u);
  });

  it("refuses a per-model frequency with no selection period", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-opponent-turn", per: "model" }]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/no selection period/u);
  });

  it("keeps a per-model usage as the ability's usage when no model is selected", () => {
    const text = "Select one friendly ALPHA unit. Each model can only be selected for this ability once per turn. It adds 1 to its Hit roll.";
    const result = resultOf([
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }],
      ["It adds 1 to its Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ], text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.mechanics)).not.toContain('"limit"');
    expect((result.mechanics as unknown as Record<string, any>).usage).toEqual({ frequency: "once-per-turn", per: "model" });
  });

  it("refuses two per-model usage limits on one model selection", () => {
    const text = "In your Command phase, select one friendly ALPHA model. Each model can only be selected once per turn. Each model can only be selected once per battle. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }],
      ["once per battle", "usage-limit", { frequency: "once-per-battle", per: "model" }],
      ["The selected model adds 1 to its Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ], text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/More than one per-model usage limit/u);
  });

  it("keeps the refusal of a per-model usage-scope on a model selection", () => {
    const result = resultOf(withUsage(["Each model can only be selected for this ability once per turn", "usage-scope", { per: "model" }]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/usage scope/u);
  });
});

const BEAST_MODEL = { side: "friendly", keywords: ["BEAST"], level: "model" };
const HIT_ROLL = ["The selected model adds 1 to its Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }] as Item;

describe("Semantic authoring model selection in the bearer's unit (membership@2)", () => {
  it("folds \"in your unit\" after a model unit-filter into its membership", () => {
    const text = "Select one BEAST model in your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>)).toMatchObject({
      filter: { owner: "friendly", all_of: ["BEAST"], level: "model", member_of: "this-unit" },
    });
  });

  it("folds a Stratagem's \"in your unit\" as the same unit as the Stratagem's target", () => {
    const text = "Fight phase. One friendly ALPHA unit. Select one friendly BEAST model in your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["in your unit", "membership", { relation: "in", of: "stratagem-target" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>).filter).toEqual({ owner: "friendly", all_of: ["BEAST"], level: "model", member_of: "stratagem-target" });
  });

  it("refuses this-unit on a Stratagem, which has no bearer", () => {
    const text = "Fight phase. One friendly ALPHA unit. Select one friendly BEAST model in your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/no bearer/u);
  });

  it("refuses the Stratagem target as an ability's membership", () => {
    const text = "Select one BEAST model in your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["in your unit", "membership", { relation: "in", of: "stratagem-target" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/names this unit/u);
  });

  it("refuses a selected model's membership other than in its unit", () => {
    const text = "Select one BEAST model embarked within your unit. The selected model adds 1 to its Hit roll.";
    const result = resultOf([
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["BEAST model", "unit-filter", BEAST_MODEL],
      ["embarked within your unit", "membership", { relation: "embarked-in", of: "this-unit" }],
      HIT_ROLL,
    ], text);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/only being a model of its unit/u);
  });

  it("accepts stratagem-target only in membership version 2", () => {
    expect(currentFamilyVersion("membership")).toBe(3);
    // Version 3 (families/regions.ts) adds antecedent; version 2 still refuses it.
    expect(() => normalizeFingerprintParameters("membership", { relation: "in", of: "antecedent" }, 2)).toThrow();
    expect(normalizeFingerprintParameters("membership", { relation: "in", of: "antecedent" }, 3)).toEqual({ relation: "in", of: "antecedent" });
    expect(normalizeFingerprintParameters("membership", { relation: "in", of: "stratagem-target" }, 2)).toEqual({ relation: "in", of: "stratagem-target" });
    expect(() => normalizeFingerprintParameters("membership", { relation: "in", of: "stratagem-target" }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("membership", { relation: "embarked-in", of: "stratagem-target" }, 2)).toThrow(/relation in/u);
    expect(normalizeFingerprintParameters("membership", { relation: "in", of: "this-unit" }, 2)).toEqual({ relation: "in", of: "this-unit" });
  });
});

// The bearer ability ids are real record ids: a one-model Knights enhancement, and a multi-model unit's ability.
const ONE_MODEL_BEARER = "bearer-of-the-evanescent-ion-valourstrike-lance-imperial-knights";
const MULTI_MODEL_BEARER = "sworn-protectors-adepta-sororitas";

describe("Semantic authoring other-model selection on a one-model bearer", () => {
  const text = "Select one other IMPERIAL KNIGHTS model in your army. The selected model adds 1 to its Hit roll.";
  const items: Item[] = [
    ["Select one", "select-unit", { distance: "any", visible: false }],
    ["other IMPERIAL KNIGHTS model in your army", "unit-filter", { side: "friendly", keywords: ["IMPERIAL KNIGHTS"], other: true, level: "model" }],
    HIT_ROLL,
  ];

  it("excludes only the bearer's unit when the bearer is one model", () => {
    const result = resultOf(items, text, ONE_MODEL_BEARER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectorOf(result.mechanics as unknown as Record<string, any>)).toMatchObject({
      filter: { owner: "friendly", all_of: ["IMPERIAL KNIGHTS"], level: "model", excluding: "this-unit" },
    });
  });

  it("refuses when the bearer's unit can have several models", () => {
    const result = resultOf(items, text, MULTI_MODEL_BEARER);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/one model/u);
  });

  it("refuses when no bearer's unit size is known", () => {
    const result = resultOf(items, text, "no-such-ability");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/one model/u);
    expect(!resultOf(items, text).ok).toBe(true);
  });
});

describe("Semantic authoring model selection with an attack gate", () => {
  it("refuses an attack made by the selected model, whose gate would otherwise be dropped", () => {
    const text = "Select one friendly ALPHA model. Each model can only be selected for this ability once per turn. Each time that ALPHA model makes an attack, add 1 to the Hit roll.";
    const result = resultOf([
      ["Select one friendly", "select-unit", { distance: "any", visible: false }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }],
      ["Each time that ALPHA model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ], text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("attack gate");
  });
});

describe("Semantic authoring per-model cap in a compound ability", () => {
  it("refuses a per-model cap when a later part follows the model selection", () => {
    const text = "In your Command phase, select one friendly ALPHA model. Each model can only be selected once per Command phase. The selected model regains D3 wounds. When it attacks, add 1 to the Hit roll.";
    const result = resultOf([
      ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["Each model can only be selected once per Command phase", "usage-limit", { frequency: "once-per-command-phase", per: "model" }],
      ["The selected model regains D3 wounds", "regain-wounds", { subject: "selected-unit", amount: "D3" }],
      ["When it attacks", "event", { kind: "attacks-resolved", action_kind: "attack", subject: "antecedent" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ], text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("no decided reading yet");
  });
});

{
  /** The family versions the extensions under test create. */
  const SELECT_COUNT_POOL_AND_PAIRING_VERSIONS: ReadonlySet<string> = new Set(["select-unit@6"]);

  /** The select-unit version just before the distance-free within_of extension (later extensions may sit above it). */
  function previousSelectUnit(): number {
    for (let version = currentFamilyVersion("select-unit"); version > 1; version -= 1) {
      const extension = familyExtension("select-unit", version);
      if (extension !== undefined && SELECT_COUNT_POOL_AND_PAIRING_VERSIONS.has(`${extension.family}@${extension.version}`)) return version - 1;
    }
    throw new Error("The extension does not extend select-unit.");
  }

  /** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
  const TEXT = "Select one friendly ALPHA model. Select one enemy BRAVO unit within 8 inches of that model. That unit suffers 1 mortal wound.";

  /** A model named as "anchor", and an enemy unit within 8 inches of it, which suffers a mortal wound. */
  const PAIR: Item[] = [
    ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "anchor" }],
    ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
    ["Select one enemy", "select-unit", { distance: "within", inches: 8, visible: false, within_of: "anchor" }],
    ["BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
    ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
  ];

  function resultOf(items: Item[], text = TEXT) {
    return compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-bound-selection" });
  }

  /** Every select-units selector in the compiled effect, outermost first. */
  function selectorsOf(node: unknown, out: Record<string, any>[] = []): Record<string, any>[] {
    if (node === null || typeof node !== "object") return out;
    if (Array.isArray(node)) { node.forEach((item) => selectorsOf(item, out)); return out; }
    const record = node as Record<string, any>;
    if (record.type === "select-units") out.push(record.selector);
    Object.values(record).forEach((value) => selectorsOf(value, out));
    return out;
  }

  describe("Semantic authoring bound selection: a unit measured from a named model", () => {
    it("nests the enemy selection in the model selection and binds the model's name", () => {
      const result = resultOf(PAIR);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [outer, inner] = selectorsOf(result.mechanics.effect);
      expect(outer).toMatchObject({ filter: { owner: "friendly", all_of: ["ALPHA"], level: "model" }, count: { min: 1, max: 1 }, bind_as: "anchor" });
      expect(inner.filter).toMatchObject({ owner: "enemy", all_of: ["BRAVO"], within: { range: { inches: 8 }, of: { selection_var: "anchor" } } });
      expect(inner.bind_as).toBeUndefined();
      // The effect names the inner selection, the unit that suffers the wound.
      expect(JSON.stringify(result.mechanics.effect)).toContain('"target":"selected-unit"');
    });

    it("binds visible_to the named model as its own selection reference", () => {
      const text = "Select one friendly ALPHA model. Select one enemy BRAVO unit that is visible to that model. That unit suffers 1 mortal wound.";
      const items: Item[] = [
        ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "anchor" }],
        ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
        ["Select one enemy", "select-unit", { distance: "any", visible: false, visible_to: "anchor" }],
        ["BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
        ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }],
      ];
      const result = resultOf(items, text);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [, inner] = selectorsOf(result.mechanics.effect);
      expect(inner.filter).toMatchObject({ owner: "enemy", all_of: ["BRAVO"], visible: { to: { selection_var: "anchor" } } });
      expect(inner.filter.within).toBeUndefined();
    });

    it("refuses a reference to a selection the ability does not bind", () => {
      const items = PAIR.map((item): Item => item[1] === "select-unit" && item[2].within_of ? [item[0], item[1], { ...item[2], within_of: "other" }] : item);
      const result = resultOf(items);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain('"other", which this ability does not bind');
    });

    it("refuses a measured selection when the earlier selection binds no name", () => {
      const items = PAIR.map((item): Item => item[1] === "select-unit" && item[2].bind_as ? [item[0], item[1], { ...item[2], bind_as: undefined }] : item);
      const result = resultOf(items);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain("bound by a name (bind_as)");
    });

    it("refuses a lone selection that names another selection", () => {
      const items = PAIR.slice(2);
      const result = resultOf(items, "Select one enemy BRAVO unit within 8 inches of that model. That unit suffers 1 mortal wound.");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain("selects one unit");
    });

    it("refuses a bound pair whose effects include an attack", () => {
      const withAttack: Item[] = [...PAIR.slice(0, 4), ["That unit suffers 1 mortal wound", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }]];
      const result = resultOf(withAttack);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain("not bound with it yet");
    });

    it("normalizes within_of only with a distance within, and only as a selection name", () => {
      expect(currentFamilyVersion("select-unit")).toBeGreaterThanOrEqual(3);
      expect(normalizeFingerprintParameters("select-unit", { distance: "within", inches: 8, visible: false, within_of: "anchor" }, currentFamilyVersion("select-unit")))
        .toMatchObject({ within_of: "anchor", inches: 8 });
      expect(() => normalizeFingerprintParameters("select-unit", { distance: "any", visible: false, within_of: "anchor" }, previousSelectUnit())).toThrow(/distance within/u);
      expect(() => normalizeFingerprintParameters("select-unit", { distance: "within", inches: 8, visible: false, within_of: "Anchor Model" }, currentFamilyVersion("select-unit"))).toThrow(/lowercase selection name/u);
    });
  });

  describe("Semantic authoring bound selection: an inner select with no distance of its own", () => {
    const version = () => currentFamilyVersion("select-unit");

    it("normalizes within_of with distance any, and still rejects inches there", () => {
      const leaf = { distance: "any", visible: false, within_of: "outer", bind_as: "inner" };
      expect(normalizeFingerprintParameters("select-unit", leaf, version())).toEqual(leaf);
      expect(() => normalizeFingerprintParameters("select-unit", { ...leaf, inches: 6 }, version())).toThrow();
      expect(() => normalizeFingerprintParameters("select-unit", { distance: "any", within_of: "outer" }, version())).toThrow();
    });

    it("keeps accepting every shape the previous version accepted", () => {
      for (const leaf of [
        { distance: "within", inches: 6, visible: false, within_of: "outer" },
        { distance: "any", visible: false, bind_as: "anchor" },
        { distance: "any", visible: true, visible_to: "anchor" },
        { distance: "within", inches: 3, visible: false },
      ]) expect(normalizeFingerprintParameters("select-unit", leaf, version())).toEqual(leaf);
    });

    it("rejects a within_of that is not a selection name, at either distance", () => {
      expect(() => normalizeFingerprintParameters("select-unit", { distance: "any", visible: false, within_of: "Bad Name" }, version())).toThrow(/lowercase selection name/u);
      expect(() => normalizeFingerprintParameters("select-unit", { distance: "within", inches: 6, visible: false, within_of: "Bad Name" }, version())).toThrow(/lowercase selection name/u);
    });

    const text = "Select one friendly ALPHA unit. Select one friendly CARRIER unit that unit is wholly within 6 inches of and is able to embark within. That unit can embark within that CARRIER.";
    const head: Item[] = [
      ["Select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "outer" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["Select one friendly", "select-unit", { distance: "any", visible: false, within_of: "outer", bind_as: "inner" }],
      ["CARRIER unit", "unit-filter", { side: "friendly", keywords: ["CARRIER"] }],
    ];
    const candidates: Item[] = [
      ["that unit is wholly within 6 inches of", "unit-position", { kind: "within", inches: 6, wholly: true, subject: "this-unit", of: "antecedent", negated: false }],
      ["and is able to embark within", "eligible", { subject: "antecedent", to: "embark-within", transport: "this-unit" }],
    ];
    const permission: Item = ["That unit can embark within that CARRIER", "eligibility-permission", { subject: "antecedent", activity: "embark", allow: true, into: "selection" }];

    it("compiles the pair with the 6 inches on the candidate and none on the select", () => {
      const result = resultOf([...head, ...candidates, permission], text);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [, inner] = selectorsOf(result.mechanics.effect);
      expect(inner.filter.within).toBeUndefined();
      const eligibility = JSON.stringify(inner.eligibility);
      expect(eligibility).toContain('"selection_var":"outer"');
      expect(eligibility).toContain('"inches":6');
      expect(eligibility).toContain('"wholly":true');
      expect(JSON.stringify(result.mechanics.effect)).toContain('"into":{"selection_var":"inner"}');
    });

    it("refuses the pair when no candidate leaf carries the relation", () => {
      const result = resultOf([...head, permission], text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain("needs a unit-position or eligible leaf naming that selection");
    });

    it("does not fire the guard for an inner select that measures its own distance", () => {
      const result = resultOf(PAIR);
      expect(result.ok).toBe(true);
    });

    it("refuses within_of together with a transport origin", () => {
      const origin: Item = ["Select one friendly", "select-unit", { distance: "any", visible: false, within_of: "outer", bind_as: "inner", within_origin: "bearer-transport" }];
      expect(() => resultOf([head[0]!, head[1]!, origin, head[3]!, ...candidates, permission], text)).toThrow(/needs a within distance/u);
    });
  });
}
