import { describe, expect, it } from "vitest";

import { Dataset } from "../src/data/dataset.js";
import { choiceVariants, memberKey, ownKeywords } from "../src/stack-damage/keyword-choices.js";
import type { StackMember } from "../src/stack-damage/model.js";

const dataset = Dataset.embedded();
const unit = (id: string) => dataset.units.getInFaction(id, "chaos-space-marines")!;

describe("keyword-choice variants", () => {
  it("expands a Mark of Chaos only in its detachment, one variant per mark, and none when the group does not apply", () => {
    const defiler: StackMember = { unit: unit("defiler"), role: "bodyguard" };
    // The Mark of Chaos is Pactbound Zealots' mandatory choice: each mark, and no unmarked variant.
    const marked = choiceVariants(dataset, [defiler], ["pactbound-zealots"]);
    expect(marked.map(([member]) => member!.chosen)).toEqual([["Chaos Undivided"], ["Khorne"], ["Nurgle"], ["Slaanesh"], ["Tzeentch"]]);
    // Elsewhere the Defiler takes no mark, so it carries none of them.
    const plain = choiceVariants(dataset, [defiler], ["renegade-warband"]);
    expect(plain).toHaveLength(1);
    expect(plain[0]![0]!.chosen).toBeUndefined();
    expect(ownKeywords(plain[0]![0]!).map((keyword) => keyword.toLowerCase())).not.toContain("nurgle");
  });

  it("takes each member's marks independently, and keys each variant apart", () => {
    const members: StackMember[] = [{ unit: unit("chosen"), role: "bodyguard" }, { unit: unit("chaos-lord"), role: "leader" }];
    const variants = choiceVariants(dataset, members, ["pactbound-zealots"]);
    expect(variants).toHaveLength(25);
    expect(new Set(variants.map((variant) => variant.map(memberKey).join("+"))).size).toBe(25);
    expect(ownKeywords(variants[6]![0]!)).toContain("Khorne");
  });

  it("offers no unmarked variant only for a mandatory group: a non-mandatory group's units may take none", () => {
    const group = dataset.keywordChoiceGroups.get("subterranean-assault-keywords-subterranean-assault");
    expect(group).toMatchObject({ mandatory: false, max_units: 2 });
    const holder = [...dataset.units].find((candidate) => (candidate.raw.conditional_keywords ?? []).some((entry) => entry.choice_group === group!.id))!;
    const variants = choiceVariants(dataset, [{ unit: holder, role: "bodyguard" }], ["subterranean-assault"]);
    expect(variants[0]![0]!.chosen).toBeUndefined();
    expect(variants.length).toBeGreaterThan(1);
  });
});
