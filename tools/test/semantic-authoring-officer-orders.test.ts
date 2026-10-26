import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { describeAbility } from "../src/translate/effect.js";

/**
 * An officer's datasheet ability prints how many Orders it issues and to which units, but no Orders
 * of its own: those are its faction's army rule's (Voice of Command), so the compiled issue-orders
 * names that rule as `menu_from`, and an "only these Orders" rule narrows it to option ids.
 */

// Fabricated wording in the shape of an officer's datasheet ability, not rules text.
const SOURCE = "This leader can give up to 2 Orders to SQUAD or TANK units. This leader can only give the Duty and Honour! and Fix Bayonets! Orders.";
const FACTION = { units: { faction_id: "astra-militarum" }, abilityId: "orders-example-astra-militarum" };

function at(text: string, role: string, family_id: string, family_version: number, parameters: Record<string, unknown>): CompileLeaf {
  const start = SOURCE.indexOf(text);
  if (start < 0) throw new Error(`Missing ${text}`);
  return { role, family_id, family_version, parameters, start_byte: start, end_byte: start + text.length, fragment: "RAW_TEXT" };
}

const opener = at("This leader can give up to 2 Orders", "EFFECT", "issue-orders-open", 1, { count: 2 });
const units = at("SQUAD or TANK units", "CONDITION", "unit-filter", 18, { side: "friendly", any_keywords: ["SQUAD", "TANK"] });
const only = (orders: string[]) => at("This leader can only give the Duty and Honour! and Fix Bayonets! Orders", "RESTRICTION", "order-rule", 2, { rule: "only-orders", orders });

function compiled(leaves: CompileLeaf[], options: Parameters<typeof compileLeaves>[2] = FACTION) {
  const result = compileLeaves(leaves, SOURCE, options);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

describe("an officer's Orders from its army rule's menu", () => {
  it("names the faction's Orders menu, the eligible units and the Orders it is limited to", () => {
    const mechanics = compiled([opener, units, only(["Duty and Honour!", "Fix Bayonets!"])]);
    expect(mechanics.effect).toEqual({
      type: "issue-orders",
      menu_from: "voice-of-command-astra-militarum",
      count: 2,
      eligible: { any_of: ["SQUAD", "TANK"] },
      only_options: ["duty-and-honour", "fix-bayonets"],
    });
    expect(describeAbility({ ability_id: "orders-example", name: "Orders", ...(mechanics as Record<string, unknown>) })).toBe(
      "This model can issue up to 2 Orders from Voice of Command to eligible friendly units with the SQUAD or TANK keyword, only Duty and Honour or Fix Bayonets.",
    );
  });

  it("reads one filter per bullet as alternatives, not keywords every unit must have", () => {
    const bulleted = "This leader can give up to 3 Orders to:\n■ **SQUAD** units\n■ **TANK** units\n■ **WALKER** units";
    const leafAt = (text: string, role: string, family_id: string, family_version: number, parameters: Record<string, unknown>): CompileLeaf => {
      const start = Buffer.byteLength(bulleted.slice(0, bulleted.indexOf(text)));
      return { role, family_id, family_version, parameters, start_byte: start, end_byte: start + Buffer.byteLength(text), fragment: "RAW_TEXT" };
    };
    const result = compileLeaves([
      leafAt("This leader can give up to 3 Orders", "EFFECT", "issue-orders-open", 1, { count: 3 }),
      ...["SQUAD", "TANK", "WALKER"].map((keyword) => leafAt(`${keyword}** units`, "CONDITION", "unit-filter", 18, { side: "friendly", keywords: [keyword] })),
    ], bulleted, FACTION);
    expect(result.ok ? result.mechanics.effect : result.errors).toMatchObject({ eligible: { any_of: ["SQUAD", "TANK", "WALKER"] } });
  });

  it("refuses a menu it cannot find, an Order the menu does not list, and Orders to enemy units", () => {
    const errors = (leaves: CompileLeaf[], options: Parameters<typeof compileLeaves>[2] = FACTION) => {
      const result = compileLeaves(leaves, SOURCE, options);
      return result.ok ? [] : result.errors;
    };
    // No faction: no army rule to take the Orders from.
    expect(errors([opener, units], {})).toEqual([expect.stringContaining("needs its faction's one army rule")]);
    expect(errors([opener, units, only(["Duty and Honour!", "Charge the Walls!"])])).toEqual([expect.stringContaining("are not all Orders of the faction's army rule")]);
    // An enemy unit-filter is not who an Order goes to.
    expect(errors([opener, { ...units, parameters: { side: "enemy", any_keywords: ["SQUAD", "TANK"] } }])).toEqual([expect.stringContaining("issued to friendly units")]);
  });
});
