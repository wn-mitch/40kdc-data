import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { pruneAbilities } from "../src/mfm/ability-prune.js";

// Fabricated names only. The file mixes a `’` escape with literal UTF-8, as the
// real tree does, so any re-serialisation would show in the byte comparison.
const ABILITIES = `[
  {
    "ability_id": "old-oath",
    "name": "Old Oath",
    "unit_ids": [
      "retired-walker"
    ]
  },
  {
    "ability_id": "vigil",
    "name": "Warden\\u2019s Vigil",
    "unit_ids": [
      "warden-squad",
      "retired-walker"
    ]
  },
  {
    "ability_id": "shared-ward",
    "name": "Shared Ward — kept",
    "unit_ids": [
      "retired-walker"
    ]
  },
  {
    "ability_id": "last-stand",
    "unit_ids": ["retired-walker"]
  },
  {
    "ability_id": "host-rule",
    "name": "Host Rule"
  }
]
`;
const MAPPINGS = `[
  { "source_id": "old-oath", "source_type": "ability", "phases": ["fight"] },
  { "source_id": "vigil", "source_type": "ability", "phases": ["shooting"] },
  { "source_id": "last-stand", "source_type": "ability", "phases": ["fight"] }
]
`;

let root: string | undefined;
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function tree(): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ability-prune-"));
  fs.mkdirSync(path.join(root, "wardens"));
  fs.writeFileSync(path.join(root, "wardens", "abilities.json"), ABILITIES);
  fs.writeFileSync(path.join(root, "wardens", "phase-mappings.json"), MAPPINGS);
  return root;
}

describe("pruneAbilities", () => {
  it("removes abilities only dead units carried, strips dead unit refs, and keeps every other byte", () => {
    // shared-ward lists only the dead unit, but a surviving unit still carries it.
    const units = new Map([["wardens", [{ id: "warden-squad", ability_ids: ["vigil", "shared-ward"] }]]]);
    const { dirs, staged } = pruneAbilities(units, tree());
    expect(dirs).toEqual([{ dir: "wardens", removed: ["last-stand", "old-oath"], unitRefsStripped: 2, phaseMappingsRemoved: 2 }]);

    const abilities = staged.find((s) => s.path.endsWith("abilities.json"))!;
    expect(abilities.text).toBe(`[
  {
    "ability_id": "vigil",
    "name": "Warden\\u2019s Vigil",
    "unit_ids": [
      "warden-squad"
    ]
  },
  {
    "ability_id": "shared-ward",
    "name": "Shared Ward — kept",
    "unit_ids": []
  },
  {
    "ability_id": "host-rule",
    "name": "Host Rule"
  }
]
`);
    expect(JSON.parse(abilities.text!)).toEqual(abilities.value);
    const mappings = staged.find((s) => s.path.endsWith("phase-mappings.json"))!;
    expect(mappings.text).toBe(`[
  { "source_id": "vigil", "source_type": "ability", "phases": ["shooting"] }
]
`);
  });

  it("drops every unit-scoped ability when no unit survives, and stages nothing when none is dead", () => {
    const dir = tree();
    const none = new Map<string, { id: string; ability_ids?: string[] }[]>();
    const text = pruneAbilities(none, dir).staged.find((s) => s.path.endsWith("abilities.json"))!.text;
    // host-rule has no unit_ids, so it is never pruned; everything else goes.
    expect(JSON.parse(text!)).toEqual([{ ability_id: "host-rule", name: "Host Rule" }]);

    const all = new Map([["wardens", [{ id: "retired-walker" }, { id: "warden-squad" }]]]);
    expect(pruneAbilities(all, dir).staged).toEqual([]);
  });

  it("writes an empty array when every record in the file goes", () => {
    const dir = tree();
    fs.writeFileSync(path.join(dir, "wardens", "abilities.json"), `[\n  { "ability_id": "a", "unit_ids": ["gone"] },\n  { "ability_id": "b", "unit_ids": ["gone"] }\n]\n`);
    const text = pruneAbilities(new Map(), dir).staged.find((s) => s.path.endsWith("abilities.json"))!.text;
    expect(text).toBe("[]\n");
  });
});
