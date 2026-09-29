import { closed, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** The `target` a `test`/`test-exemption` leaf names: a fixed role, or an owner+range filter. */
function testTarget(leaf: CompileLeaf): Node | string {
  const target = closed(leaf, "target") as string;
  if (target !== "enemy" && target !== "friendly") return target;
  const node: Node = { owner: target };
  const range = leaf.parameters.range;
  if (range === "inches") node.within = { range: { inches: closed(leaf, "within_inches") }, ...(leaf.parameters.of !== undefined ? { of: closed(leaf, "of") } : {}) };
  else if (range === "engagement") node.within = { range: "engagement", ...(leaf.parameters.of !== undefined ? { of: closed(leaf, "of") } : {}) };
  const require = leaf.parameters.require_keywords as string[] | undefined;
  const exclude = leaf.parameters.exclude_keywords as string[] | undefined;
  if (require?.length) node.all_of = require;
  if (exclude?.length) node.none_of = exclude;
  return node;
}

/** Batch 7b's flat effects: `test`, `test-exemption`, `destruction-rule`, `datasheet-swap`, `characteristic-resolution`, `borrow-weapons`, `select-weapon`. */
export function testEffect(leaf: CompileLeaf): Node | undefined {
  switch (leaf.family_id) {
    case "test": {
      const modifier: Node = { test: closed(leaf, "test") };
      if (leaf.parameters.modifier !== undefined) modifier.modifier = closed(leaf, "modifier");
      if (leaf.parameters.count !== undefined) modifier.count = closed(leaf, "count");
      if (leaf.parameters.per !== undefined) modifier.per = closed(leaf, "per");
      return { type: "test", target: testTarget(leaf), modifier };
    }
    case "test-exemption":
      return { type: "test-exemption", target: testTarget(leaf), modifier: { test: closed(leaf, "test"), window: closed(leaf, "window") } };
    case "destruction-rule":
      return { type: "destruction-rule", target: closed(leaf, "target"), modifier: { also: closed(leaf, "also") } };
    case "datasheet-swap":
      return { type: "datasheet-swap", target: closed(leaf, "target"), modifier: { datasheet: closed(leaf, "datasheet") } };
    case "characteristic-resolution": {
      const modifier: Node = { stat: closed(leaf, "stat"), rule: closed(leaf, "rule") };
      if (leaf.parameters.tie !== undefined) modifier.tie = closed(leaf, "tie");
      if (leaf.parameters.applies_to !== undefined) modifier.applies_to = closed(leaf, "applies_to");
      if (leaf.parameters.incoming === true) modifier.incoming = true;
      return { type: "characteristic-resolution", target: closed(leaf, "target"), modifier };
    }
    case "borrow-weapons": {
      const modifier: Node = { max_models: closed(leaf, "max_models") };
      if (leaf.parameters.weapon_type !== undefined) modifier.weapon_type = closed(leaf, "weapon_type");
      if (leaf.parameters.exclude_weapon_keyword !== undefined) modifier.exclude_weapon_keyword = closed(leaf, "exclude_weapon_keyword");
      return { type: "borrow-weapons", target: closed(leaf, "target"), modifier };
    }
    case "select-weapon": {
      const modifier: Node = { bind_as: closed(leaf, "bind_as") };
      if (leaf.parameters.count !== undefined) modifier.count = closed(leaf, "count");
      if (leaf.parameters.weapon_type !== undefined) modifier.weapon_type = closed(leaf, "weapon_type");
      if (leaf.parameters.weapon_keyword !== undefined) modifier.weapon_keyword = closed(leaf, "weapon_keyword");
      return { type: "select-weapon", target: closed(leaf, "target"), modifier };
    }
    default:
      return undefined;
  }
}
