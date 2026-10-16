import { describe, expect, it } from "vitest";
import { isLegalLeverSelection, type SelectableLever, type StackableBuffGroup } from "../src/data/index.js";

const option = (id: string) => ({ ability_id: "menu", option_id: id });
const groups: StackableBuffGroup[] = [{ id: "pool", abilityId: "menu", label: "Display label", maxActivations: 1 }];
const choices: SelectableLever[] = ["a", "b", "c"].map((id) => ({ id: `provider>menu#${id}`, group: "pool" }));
const legal = (levers: SelectableLever[], ids: string[], pools = groups) => isLegalLeverSelection(levers, pools, new Set(ids));
const ids = choices.map((choice) => choice.id);

describe("complete lever selection legality", () => {
  it("checks every intersecting pool, including after a stance capacity raise", () => {
    const levers = choices.map((choice) => ({ ...choice, groups: ["usage"] }));
    const capacity: SelectableLever = { id: "raise", raisesCap: { group: "pool", by: 2, allocation: "choose-one-option" } };
    const pools = [...groups, { id: "usage", label: "Shared use", maxActivations: 1 }];
    expect(legal([...levers, capacity], [ids[0], "raise"], pools)).toBe(true);
    expect(legal([...levers, capacity], [ids[0], ids[1], "raise"], pools)).toBe(false);
  });

  it("spends fixed-option capacity only on that option, independently of selection order", () => {
    const capacity: SelectableLever = { id: "raise", raisesCap: { group: "pool", by: 1, allocation: "fixed-option", option: option("a") } };
    expect(legal([...choices, capacity], [ids[0], ids[1], "raise"])).toBe(true);
    expect(legal([...choices].reverse().concat(capacity), [ids[0], ids[1], "raise"])).toBe(true);
    expect(legal([...choices, capacity], [ids[1], ids[2], "raise"])).toBe(false);
  });

  it("assigns overlapping subset capacity without spending one slot twice", () => {
    const raises: SelectableLever[] = [
      { id: "first", raisesCap: { group: "pool", by: 1, allocation: "choose-one-option", options: [option("a"), option("b")] } },
      { id: "second", raisesCap: { group: "pool", by: 1, allocation: "fixed-option", option: option("a") } },
    ];
    expect(legal([...choices, ...raises], [...ids, "first", "second"])).toBe(true);
    raises[0].raisesCap!.options = [option("a")];
    expect(legal([...choices, ...raises], [...ids, "first", "second"])).toBe(false);
  });

  it("requires cost-bearing providers and rejects unknown pools and unknown ids", () => {
    const levers: SelectableLever[] = [{ id: "provider" }, { ...choices[0], requiresLever: "provider" }];
    expect(legal(levers, [ids[0]])).toBe(false);
    expect(legal(levers, [ids[0], "provider"])).toBe(true);
    expect(legal(levers, ["absent"])).toBe(false);
    expect(legal(levers, [ids[0], "provider"], [])).toBe(false);
  });
});
