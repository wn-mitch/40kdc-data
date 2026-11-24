import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeEffect } from "../src/translate/effect.js";
import type { Effect } from "../src/translate/effect.js";

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
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const UNITS = { faction_id: "fabricated", units: [{ id: "alpha-squad", name: "Alpha Squad" }, { id: "beta-walker", name: "Beta Walker" }] };

/** `null` compiles without a units context. */
const run = (text: string, items: Item[], units: typeof UNITS | null = UNITS) =>
  compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-combat-patrol", ...(units ? { units } : {}) });

function compiled(text: string, ...items: Item[]): Record<string, unknown> {
  const result = run(text, items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, unknown>;
}

function errorsOf(text: string, items: Item[], units: typeof UNITS | null = UNITS): string {
  const result = run(text, items, units);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics.effect)}`);
  return result.errors.join("; ");
}

/** Fabricated wording in the printed shape of a Combat Patrol schedule. */
const TEXT = "When playing a fabricated battle, the following units must arrive late, and must arrive wholly within your zone. Alpha Squad: Battle round 2. Beta Walker: Battle round 3.";
const MODE: Item = ["When playing a fabricated battle", "game-mode", { modes: ["combat-patrol"] }];
const SCHEDULE: Item = ["the following units must arrive late, and must arrive wholly within your zone", "reserves-schedule", { set_up: "wholly-within-deployment-zone" }];
const ALPHA: Item = ["Alpha Squad", "unit-filter", { side: "friendly", datasheets: ["alpha-squad"] }];
const ROUND_2: Item = ["Battle round 2", "battle-round", { min: 2 }];
const BETA: Item = ["Beta Walker", "unit-filter", { side: "friendly", unit_names: ["Beta Walker"] }];
const ROUND_3: Item = ["Battle round 3", "battle-round", { min: 3 }];

describe("Combat Patrol: the game-mode condition and the reserves schedule", () => {
  it("folds each datasheet row and its round into one schedule, gated on the game mode", () => {
    const effect = compiled(TEXT, MODE, SCHEDULE, ALPHA, ROUND_2, BETA, ROUND_3);
    expect(effect).toEqual({
      type: "conditional",
      condition: { type: "game-mode", parameters: { modes: ["combat-patrol"] } },
      effect: {
        type: "reserves-schedule",
        target: { owner: "friendly" },
        modifier: {
          // The printed name row resolves through the units context, like a reviewed datasheet row.
          entries: [{ unit_id: "alpha-squad", battle_round: 2 }, { unit_id: "beta-walker", battle_round: 3 }],
          set_up: "wholly-within-deployment-zone",
        },
      },
    });
    expect(describeEffect(effect as unknown as Effect)).toBe(
      "If the battle is a Combat Patrol battle, the following friendly units must start the battle in Strategic Reserves and cannot be set up on the battlefield before the battle round stated: Alpha Squad (battle round 2) and Beta Walker (battle round 3); when they are set up, they must be set up wholly within your deployment zone.",
    );
  });

  it("keeps a Combat Patrol sentence out of an earlier moment's selection", () => {
    // Without the game-mode split, the record's opening moment and selection would also gate the schedule.
    const text = "At the end of your Command phase, you can select one friendly unit. That unit has +1 OC. When playing a fabricated battle, the following units must arrive late. Alpha Squad: Battle round 2.";
    const effect = compiled(text,
      ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
      ["you can", "optional-use", { who: "you" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly unit", "unit-filter", { side: "friendly" }],
      ["That unit has +1 OC", "characteristic-modifier", { subject: "antecedent", characteristics: ["OC"], operation: "add", value: 1, weapon_type: "all" }],
      MODE,
      ["the following units must arrive late", "reserves-schedule", {}],
      ALPHA, ROUND_2);
    const schedule = { type: "conditional", condition: { type: "game-mode", parameters: { modes: ["combat-patrol"] } }, effect: { type: "reserves-schedule", target: { owner: "friendly" }, modifier: { entries: [{ unit_id: "alpha-squad", battle_round: 2 }] } } };
    expect(effect.type).toBe("sequence");
    const steps = effect.steps as Record<string, unknown>[];
    expect(steps.at(-1)).toEqual(schedule);
    // The schedule appears once, at the top level, and the moment's part does not hold it.
    expect(JSON.stringify(steps.slice(0, -1))).not.toContain("reserves-schedule");
  });

  it("refuses a row whose round is missing", () => {
    expect(errorsOf(TEXT, [MODE, SCHEDULE, ALPHA, ROUND_2, BETA])).toContain("no \"Battle round N\" after it");
  });

  it("refuses a round 1 row, which schedules nothing", () => {
    const text = TEXT.replace("Battle round 2", "Battle round 1");
    expect(errorsOf(text, [MODE, SCHEDULE, ALPHA, ["Battle round 1", "battle-round", { min: 1 }], BETA, ROUND_3])).toContain("battle round 2 or later");
  });

  it("refuses a round row that is a range", () => {
    expect(errorsOf(TEXT, [MODE, SCHEDULE, ALPHA, ["Battle round 2", "battle-round", { min: 2, max: 3 }], BETA, ROUND_3])).toContain("a min alone");
  });

  it("refuses a datasheet the faction does not have", () => {
    const units = { faction_id: "fabricated", units: [{ id: "beta-walker", name: "Beta Walker" }] };
    expect(errorsOf(TEXT, [MODE, SCHEDULE, ALPHA, ROUND_2, BETA, ROUND_3], units)).toContain("alpha-squad, which is no datasheet of fabricated");
  });

  it("refuses the same datasheet twice", () => {
    const text = TEXT.replace("Beta Walker:", "Alpha Squad:");
    expect(errorsOf(text, [MODE, SCHEDULE, ALPHA, ROUND_2, ["Alpha Squad", "unit-filter", { side: "friendly", datasheets: ["alpha-squad"] }], ROUND_3])).toContain("lists alpha-squad twice");
  });

  it("refuses a row heading that names two datasheets or more than a datasheet", () => {
    expect(errorsOf(TEXT, [MODE, SCHEDULE, ["Alpha Squad", "unit-filter", { side: "friendly", datasheets: ["alpha-squad", "beta-walker"] }], ROUND_2])).toContain("names 2 datasheets");
    expect(errorsOf(TEXT, [MODE, SCHEDULE, ["Alpha Squad", "unit-filter", { side: "enemy", datasheets: ["alpha-squad"] }], ROUND_2])).toContain("side enemy");
  });

  it("refuses a schedule with no rows, two schedules, or no units context", () => {
    expect(errorsOf(TEXT, [MODE, SCHEDULE])).toContain("has no rows after it");
    const two = `${TEXT} The following units must arrive late, and must arrive wholly within your zone.`;
    expect(errorsOf(two, [MODE, SCHEDULE, ALPHA, ROUND_2, ["The following units must arrive late, and must arrive wholly within your zone", "reserves-schedule", {}]])).toContain("2 reserves schedules");
    expect(errorsOf(TEXT, [MODE, SCHEDULE, ALPHA, ROUND_2], null)).toContain("needs the owning faction's unit catalog");
  });
});

describe("Combat Patrol: game-mode and battle-size tables", () => {
  it("normalizes game modes into enum order and refuses a repeat", () => {
    const version = currentFamilyVersion("game-mode");
    expect(normalizeFingerprintParameters("game-mode", { modes: ["combat-patrol", "matched-play"] }, version)).toEqual({ modes: ["matched-play", "combat-patrol"] });
    expect(() => normalizeFingerprintParameters("game-mode", { modes: ["combat-patrol", "combat-patrol"] }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("game-mode", { modes: ["not-a-game-mode"] }, version)).toThrow();
  });

  it("renders a negated game mode as an Unless lead-in", () => {
    const effect = { type: "conditional", condition: { operator: "not", operands: [{ type: "game-mode", parameters: { modes: ["combat-patrol"] } }] }, effect: { type: "feel-no-pain", target: "this-unit", modifier: { threshold: 6 } } };
    expect(describeEffect(effect as unknown as Effect)).toBe("Unless the battle is a Combat Patrol battle, this unit has Feel No Pain 6+.");
  });

  it("prints a Combat Patrol row first in a battle-size amount, and keeps a three-size table unchanged", () => {
    const gain = (amount: Record<string, number>) => describeEffect({ type: "resource-gain", target: "this-model", modifier: { pool: "resurgence-points", amount } } as unknown as Effect);
    expect(gain({ incursion: 6, "strike-force": 10, onslaught: 14, "combat-patrol": 2 })).toBe("You gain 2/6/10/14 Resurgence points (Combat Patrol/Incursion/Strike Force/Onslaught).");
    expect(gain({ incursion: 6, "strike-force": 10, onslaught: 14 })).toBe("You gain 6/10/14 Resurgence points (Incursion/Strike Force/Onslaught).");
  });

  it("compiles a resource-gain table with a Combat Patrol amount", () => {
    const text = "you start the battle with points";
    const effect = compiled(text, [text, "resource-gain", { pool: "resurgence-points", amount: { "combat-patrol": 2, incursion: 6, "strike-force": 10, onslaught: 14 } }]);
    expect(JSON.stringify(effect)).toContain('"amount":{"combat-patrol":2,"incursion":6,"strike-force":10,"onslaught":14}');
  });
});
