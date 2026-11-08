import { describe, expect, it } from "vitest";

import {
  transformAppliesTo,
  transformCondition,
  transformFilters,
  transformUnitFilter,
} from "../src/round6/vocab-cutover-filters.js";
import type { CutoverContext, Node } from "../src/round6/vocab-cutover-types.js";

function context(reasons: string[] = []): CutoverContext {
  return {
    file: "fixture.json",
    record: "fixture",
    pointer: "/effect",
    report: (reason) => reasons.push(reason),
  };
}

describe("round6 filter cutover", () => {
  it("canonicalizes flattened unit selectors with exact count, origin, range, visibility and engagement", () => {
    const output = transformFilters({
      type: "select-units",
      selector: {
        owner: "enemy",
        count: 1,
        target_kind: "unit",
        keywords: ["INFANTRY", "MONSTER"],
        within_inches: 12,
        reference: "bearer-unit",
        visibility_required: true,
        engagement_relation: "engaged-with-bearer",
      },
      effect: { type: "test", target: "selected-unit" },
      unknown_wrapper: "retain",
    }, context());

    expect(output).toEqual({
      type: "select-units",
      selector: {
        filter: {
          owner: "enemy",
          level: "unit",
          all_of: ["INFANTRY", "MONSTER"],
          within: { range: { inches: 12 }, of: "this-unit" },
          visible: { to: "this-unit" },
          engaged_with: "this-unit",
        },
        count: { min: 1, max: 1 },
      },
      effect: { type: "test", target: "selected-unit" },
      unknown_wrapper: "retain",
    });
  });

  it("retains objective selection as a typed discriminator and preserves symbolic cardinality", () => {
    const output = transformFilters({
      type: "designate-target",
      designation: "marked",
      select: {
        scope: "objective",
        max_count: "all-matching",
        controlled_by: "friendly",
        bind_as: "marker",
      },
      applies: {
        to: "target",
        effect: { type: "no-effect" },
      },
    }, context());

    expect(output).toMatchObject({
      select: {
        kind: "objective",
        selector: {
          filter: { controlled_by: "friendly" },
          count: { min: 0, max: "all-matching" },
          bind_as: "marker",
        },
      },
    });
    expect((output.select as Node).selector).toEqual({
      filter: { controlled_by: "friendly" },
      count: { min: 0, max: "all-matching" },
      bind_as: "marker",
    });
  });

  it("keeps complete any_of_filters alternatives instead of pooling their keywords", () => {
    const output = transformUnitFilter({
      owner: "friendly",
      any_of_filters: [
        { all_of: ["ALPHA"], none_of: ["DELTA"] },
        { keywords: ["BETA", "GAMMA"], keyword_match: "all" },
      ],
    }, context());

    expect(output).toEqual({
      owner: "friendly",
      any_of_filters: [
        { all_of: ["ALPHA"], none_of: ["DELTA"] },
        { all_of: ["BETA", "GAMMA"] },
      ],
    });
  });

  it("normalizes static applies_to without inferring it from the effect", () => {
    expect(transformAppliesTo({
      required_keywords: ["INFANTRY"],
      excluded_keywords: ["CHARACTER"],
    }, context())).toEqual({
      all_of: ["INFANTRY"],
      none_of: ["CHARACTER"],
    });
    expect(transformAppliesTo(null, context())).toBeNull();
    expect(transformAppliesTo({}, context())).toEqual({});
  });

  it("folds ordinary ownership, keyword, state, range, visibility and designation atoms into matches", () => {
    const cases: Array<[Node, Node]> = [
      [{ type: "owned-by", parameters: { subject: "defender", owner: "enemy" } }, { type: "matches", parameters: { subject: "defender", filter: { owner: "enemy" } } }],
      [{ type: "has-keyword", parameters: { any_of: ["MONSTER", "VEHICLE"] } }, { type: "matches", parameters: { filter: { any_of: ["MONSTER", "VEHICLE"] } } }],
      [{ type: "unit-state", parameters: { state: "unengaged" } }, { type: "matches", parameters: { filter: { not_states: ["engaged"] } } }],
      [{ type: "within", parameters: { subject: "this-unit", of: "this-model", range: { inches: 6 }, wholly: true } }, { type: "matches", parameters: { subject: "this-unit", filter: { within: { range: { inches: 6 }, of: "this-model", wholly: true } } } }],
      [{ type: "visible", parameters: { subject: "defender", to: "attacker" } }, { type: "matches", parameters: { subject: "defender", filter: { visible: { to: "attacker" } } } }],
      [{ type: "designated", parameters: { subject: "defender", tag: "spotted" } }, { type: "matches", parameters: { subject: "defender", filter: { designated: "spotted" } } }],
    ];

    for (const [input, expected] of cases) expect(transformCondition(input, context())).toEqual(expected);
  });

  it("retains differentiated atoms and reports conflicting aliases without guessing", () => {
    const reasons: string[] = [];
    const ctx = context(reasons);
    const retained = transformCondition({
      type: "within",
      parameters: { subject: "this-unit", of: "this-model", range: { inches: 6 }, models: "every" },
    }, ctx);
    const ambiguous = transformUnitFilter({ within_inches: 6, range_inches: 12, owner: "friendly" }, ctx);

    expect(retained).toEqual({
      type: "within",
      parameters: { subject: "this-unit", of: "this-model", range: { inches: 6 }, models: "every" },
    });
    expect(ambiguous).toMatchObject({ within_inches: 6, range_inches: 12 });
    expect(reasons.some((reason) => reason.includes("disagree"))).toBe(true);
  });

  it("keeps explicit designation application filters separate", () => {
    const output = transformFilters({
      type: "designate-target",
      designation: "marked",
      select: { scope: "enemy-unit", count: 1 },
      applies: {
        to: "attackers-of-target",
        attacker_keywords: ["INFANTRY"],
        attacker_unit_keywords: ["ADEPTUS ASTARTES"],
        effect: { type: "no-effect" },
      },
    }, context());

    expect(output).toMatchObject({
      applies: {
        attacker_filter: { level: "model", all_of: ["INFANTRY"] },
        attacker_unit_filter: { all_of: ["ADEPTUS ASTARTES"] },
      },
    });
  });

  it("keeps place-reference origins and allowance cardinality symbolic", () => {
    const output = transformFilters({
      type: "for-each-unit",
      selector: {
        owner: "friendly",
        max_count: "all-matching",
        allowance: { count: 1, period: "turn" },
        within_inches: 9,
        within_objective: { selection_var: "chosen-objective" },
        visibility_required: false,
      },
    }, context());

    expect(output).toEqual({
      type: "for-each-unit",
      selector: {
        filter: {
          owner: "friendly",
          within: {
            range: { inches: 9 },
            of: { objective: { selection_var: "chosen-objective" } },
          },
        },
        count: { min: 0, max: "all-matching" },
        limit: { count: 1, period: "turn" },
      },
    });
  });

  it("normalizes paired selector predicates without treating metadata as a filter", () => {
    const output = transformFilters({
      type: "paired-unit-selector",
      owner: "enemy",
      count: 1,
      selection_mode: "any-number",
      requires_ability: "stealth",
      visible_to: "bearer-unit",
      metadata: { keywords: ["DO NOT FILTER"] },
    }, context());

    expect(output).toEqual({
      filter: {
        owner: "enemy",
        has_ability: ["stealth"],
        visible: { to: "this-unit" },
      },
      count: { min: 1, max: 1 },
      selection_mode: "any-number",
      metadata: { keywords: ["DO NOT FILTER"] },
    });
  });

  it("only transforms a filter-shaped target when the walker identifies its slot", () => {
    const untouched = transformFilters({ owner: "friendly", keywords: ["metadata"] }, context());
    const targeted = transformFilters({ owner: "friendly", keywords: ["INFANTRY"] }, {
      ...context(),
      parentKey: "target",
    });

    expect(untouched).toEqual({ owner: "friendly", keywords: ["metadata"] });
    expect(targeted).toEqual({ owner: "friendly", all_of: ["INFANTRY"] });
  });

  it("normalizes weapon scopes and nested unit-filter origins", () => {
    expect(transformCondition({
      type: "attack-is",
      parameters: { weapon_name: "Storm Eagle Rockets" },
    }, context())).toEqual({
      type: "attack-is",
      parameters: { weapons: { name: "Storm Eagle Rockets" } },
    });

    expect(transformCondition({
      type: "matches",
      parameters: {
        filter: {
          within: {
            range: { inches: 6 },
            of: { owner: "enemy", visible: true },
          },
        },
      },
    }, context())).toEqual({
      type: "matches",
      parameters: {
        filter: {
          within: {
            range: { inches: 6 },
            of: { owner: "enemy", visible: { to: "this-model" } },
          },
        },
      },
    });
  });
});
