/** Constructors for the BSData node shapes the exporter emits. */
import type { BsNode } from "./source.js";

export const XMLNS_GAME_SYSTEM = "http://www.battlescribe.net/schema/gameSystemSchema";
export const XMLNS_CATALOGUE = "http://www.battlescribe.net/schema/catalogueSchema";
export const BATTLESCRIBE_VERSION = 2.03;

/** Drops `undefined` values and empty arrays, which BSData never writes. */
export function compact(node: Record<string, unknown>): BsNode {
  const out: BsNode = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export interface ConstraintSpec {
  readonly id: string;
  readonly type: "min" | "max";
  readonly value: number;
  /** `selections`, `forces`, `associations` or a cost type id. */
  readonly field: string;
  readonly scope: string;
  readonly childId?: string;
  readonly childName?: string;
  readonly includeChildSelections?: boolean;
  readonly includeChildForces?: boolean;
}

export function constraint(spec: ConstraintSpec): BsNode {
  return compact({
    id: spec.id,
    childId: spec.childId,
    childName: spec.childName,
    field: spec.field,
    includeChildForces: spec.includeChildForces,
    includeChildSelections: spec.includeChildSelections,
    scope: spec.scope,
    shared: true,
    type: spec.type,
    value: spec.value,
  });
}

export interface ConditionSpec {
  readonly childId: string;
  readonly childName?: string;
  readonly field: string;
  readonly scope: string;
  readonly type: "atLeast" | "lessThan" | "equalTo" | "greaterThan" | "atMost" | "instanceOf" | "notInstanceOf" | "before";
  readonly value: number;
  readonly includeChildSelections?: boolean;
  readonly includeChildForces?: boolean;
}

export function condition(spec: ConditionSpec): BsNode {
  return compact({
    childId: spec.childId,
    childName: spec.childName,
    field: spec.field,
    includeChildForces: spec.includeChildForces,
    includeChildSelections: spec.includeChildSelections,
    scope: spec.scope,
    shared: true,
    type: spec.type,
    value: spec.value,
  });
}

export function modifier(spec: {
  readonly field: string;
  readonly type: string;
  readonly value: number | string | boolean;
  readonly conditions?: readonly BsNode[];
  readonly conditionGroups?: readonly BsNode[];
  readonly repeats?: readonly BsNode[];
}): BsNode {
  return compact({
    field: spec.field,
    type: spec.type,
    value: spec.value,
    conditions: spec.conditions ? [...spec.conditions] : undefined,
    conditionGroups: spec.conditionGroups ? [...spec.conditionGroups] : undefined,
    repeats: spec.repeats ? [...spec.repeats] : undefined,
  });
}

export function cost(name: string, typeId: string, value: number): BsNode {
  return { name, typeId, value };
}

export function categoryLink(name: string, id: string, targetId: string, primary: boolean): BsNode {
  return { name, id, hidden: false, primary, targetId };
}

export function entryLink(spec: {
  readonly name: string;
  readonly id: string;
  readonly targetId: string;
  readonly type: "selectionEntry" | "selectionEntryGroup";
  readonly constraints?: readonly BsNode[];
  readonly modifiers?: readonly BsNode[];
  readonly categoryLinks?: readonly BsNode[];
  readonly collective?: boolean;
}): BsNode {
  return compact({
    name: spec.name,
    id: spec.id,
    collective: spec.collective,
    hidden: false,
    import: true,
    targetId: spec.targetId,
    type: spec.type,
    categoryLinks: spec.categoryLinks ? [...spec.categoryLinks] : undefined,
    constraints: spec.constraints ? [...spec.constraints] : undefined,
    modifiers: spec.modifiers ? [...spec.modifiers] : undefined,
  });
}

export function characteristic(name: string, typeId: string, text: string): BsNode {
  return { name, $text: text, typeId };
}

export function profile(name: string, id: string, typeId: string, typeName: string, characteristics: readonly BsNode[]): BsNode {
  return { name, id, hidden: false, typeId, typeName, characteristics: [...characteristics] };
}

/** A `hidden: true` modifier that applies while `conditions` all hold. */
export function hiddenWhen(conditions: readonly BsNode[]): BsNode {
  return conditions.length === 1
    ? modifier({ field: "hidden", type: "set", value: true, conditions })
    : modifier({ field: "hidden", type: "set", value: true, conditionGroups: [{ type: "and", conditions: [...conditions] }] });
}
