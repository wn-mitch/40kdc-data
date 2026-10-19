import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { allOf, attackTypeCondition } from "./compile-conditions.js";

type Node = Record<string, unknown>;
type Planned = { index: number; leaf: CompileLeaf; node: Node; gate: Node[]; selected: boolean };

/** Keep a permission and the effects on its returned attacks in one resolution, never a phase-long buff. */
export function groupPermissionAttacks(list: readonly CompileLeaf[], planned: Planned[]): void {
  for (let at = list.length - 1; at >= 0; at -= 1) {
    const context = list[at]!;
    if (context.family_id !== "attack" || context.parameters.permission_start === undefined) continue;
    const permission = planned.find((item) => item.leaf.family_id === "eligibility-permission"
      && item.leaf.start_byte === context.parameters.permission_start);
    if (!permission || permission.node.type !== "permission") throw new CompileError("Returned attacks lost their preceding permission during composition.");
    let end = at + 1;
    while (end < list.length && list[end]!.fragment === context.fragment && list[end]!.role !== "EVENT") end += 1;
    const affected = planned.filter((item) => item.index > at && item.index < end);
    if (!affected.length) throw new CompileError("A returned-attack context has no effect on its attacks.");
    if (affected.some((item) => item.selected !== permission.selected)) throw new CompileError("Returned attacks and their permission name different selections.");
    const recipient = permission.node.target;
    const retarget = (node: Node): Node => node.type === "sequence"
      ? { ...node, steps: (node.steps as Node[]).map(retarget) }
      : { ...node, target: structuredClone(recipient) };
    const steps = [permission, ...affected].map((item) => {
      const node = item.leaf.parameters.subject === "attack" ? retarget(item.node) : item.node;
      const attackGate = item !== permission ? attackTypeCondition(context) : null;
      const gate = allOf([...item.gate, ...(attackGate ? [attackGate] : [])]);
      return gate ? { type: "conditional", condition: gate, effect: node } : node;
    });
    permission.node = { type: "ability-part", duration: "resolution", effect: { type: "sequence", steps } };
    permission.gate = [];
    for (const item of affected) planned.splice(planned.indexOf(item), 1);
  }
}
