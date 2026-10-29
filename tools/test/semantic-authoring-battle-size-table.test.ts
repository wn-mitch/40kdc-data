import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { createValidator } from "../src/schema-loader.js";
import { describeEffectInline } from "../src/translate/effect.js";
import { placed } from "./semantic-authoring-connective-fixture.js";

// A choice of three options, each capped "as shown below" by one battle-size table printed after
// the last option. Wording, option names and marks are fabricated.

const CAP = { incursion: 2, "strike-force": 3, onslaught: 4 };
const OPTION_A = "■ Rain: Roll one D6 for each enemy unit: on a 5+, that unit is soaked. The most units this soaks depends on the battle size, as shown below.";
const OPTION_B = "■ Fog: Select a number of enemy units. Those enemy units are fogged. The most units you pick depends on the battle size, as shown below.";
const OPTION_C = "■ Haze: Select a number of units from your army. Those units have the Stealth ability. The most units you pick depends on the battle size, as shown below.";
const TABLE = "Incursion games: you can take 2. Strike Force games: you can take 3. Onslaught games: you can take 4.";

type Item = Parameters<typeof placed>[1];

function record(table: Record<string, number> = CAP) {
  const text = `At the start of the battle round, select one of the following weathers.\n${OPTION_A}\n${OPTION_B}\n${OPTION_C}\n${TABLE}`;
  const items: Item[] = [
    ["At the start of the battle round", "turn-start", { turn: "battle-round" }],
    ["select one of the following weathers", "choice-open", { choice_label: "weather", min_choices: 1, max_choices: 1 }],
    ["Rain", "named-option", { label: "Rain", option_id: "rain" }],
    ["Roll one D6", "dice-roll", { dice: "D6" }],
    ["for each enemy unit", "for-each-unit-select", { scope: "enemy", distance: "any" }],
    ["on a 5+", "roll-result", { from: 5 }],
    ["that unit is soaked", "apply-mark", { subject: "antecedent", tag: "shaken" }],
    ["The most units this soaks depends on the battle size, as shown below", "count-by-battle-size", CAP],
    ["Fog", "named-option", { label: "Fog", option_id: "fog" }],
    ["Select a number of enemy units", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["Those enemy units are fogged", "apply-mark", { subject: "selected-unit", tag: "scattered" }],
    ["The most units you pick depends on the battle size, as shown below", "count-by-battle-size", CAP],
    ["Haze", "named-option", { label: "Haze", option_id: "haze" }],
    ["Select a number of units from your army", "select-unit", { scope: "friendly", distance: "any", visible: false }],
    ["Those units have the Stealth ability", "core-ability-grant", { subject: "antecedent", ability: "stealth" }],
    ["The most units you pick depends on the battle size, as shown below", "count-by-battle-size", CAP],
    ...(["Incursion", "Strike Force", "Onslaught"] as const).flatMap((size, at): Item[] => [
      [`${size} games`, "battle-size", { size: size.toLowerCase().replace(" ", "-") }],
      ["you can", "optional-use", { who: "you" }],
      [`take ${at + 2}`, "count-by-battle-size", table],
    ]),
  ];
  // "for each enemy unit" holds its own unit-filter, as the reviewed loop does; placed() only lays leaves end to end.
  const leaves = placed(text, ...items);
  const loop = leaves.find((leaf) => leaf.family_id === "for-each-unit-select")!;
  const [filter] = placed(text, ["enemy unit", "unit-filter", { side: "enemy" }]);
  const loopEnd = loop.end_byte!;
  const nested = { ...filter!, start_byte: loopEnd - Buffer.byteLength("enemy unit"), end_byte: loopEnd };
  return compileLeaves([...leaves, nested].sort((a, b) => a.start_byte - b.start_byte || (b.end_byte ?? 0) - (a.end_byte ?? 0)), text);
}

describe("a battle-size table after a choice's last named option", () => {
  it("caps every option with the table's values, the for-each by max_affected and each selection by its count", () => {
    const result = record();
    if (!result.ok) throw new Error(result.errors.join("; "));
    const options = (result.mechanics.effect as { options: Array<Record<string, any>> }).options;
    expect(options).toHaveLength(3);
    const [rain, fog, haze] = options;
    expect(JSON.stringify(rain)).toContain(`"max_affected":${JSON.stringify(CAP)}`);
    expect(JSON.stringify(fog)).toContain(`"count":{"min":0,"max":${JSON.stringify(CAP)}}`);
    expect(JSON.stringify(haze)).toContain(`"count":{"min":0,"max":${JSON.stringify(CAP)}}`);
    // The last option's own effects carry no battle-size gate from the table's rows.
    expect(JSON.stringify(haze)).not.toContain("battle-size");
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    expect(validate(result.mechanics.effect), JSON.stringify(validate.errors)).toBe(true);
  });

  it("refuses a table whose values differ from the options' caps", () => {
    const result = record({ incursion: 1, "strike-force": 3, onslaught: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/every option's cap must be the table's/u);
  });
});

describe("a for-each with a cap on the units it affects", () => {
  it("reads the cap after the units it loops over", () => {
    const effect = { type: "for-each-unit", selector: { filter: { owner: "enemy" } }, max_affected: CAP, effect: { type: "designate", target: "recipient", modifier: { tag: "shaken" } } };
    expect(describeEffectInline(effect as never)).toMatch(/^for each enemy unit, up to 2\/3\/4 units \(Incursion\/Strike Force\/Onslaught\) of your choice: /u);
  });
});
