/**
 * The fixed equipment of a BSData model peer, read as its complete per-model
 * alternatives (one per pick of each defaultless required equipment choice).
 */

export type JsonNode = Record<string, unknown>;

export const arr = (value: unknown): JsonNode[] => Array.isArray(value) ? value.filter((v): v is JsonNode => !!v && typeof v === "object" && !Array.isArray(v)) : [];
export const str = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
export const constraints = (node: JsonNode, type: string): JsonNode[] => arr(node.constraints).filter((c) => c.type === type && c.field === "selections");
export const constraint = (node: JsonNode, type: string): number | undefined => constraints(node, type).map((c) => c.value).find((v): v is number => typeof v === "number");
export const children = (node: JsonNode): JsonNode[] => [
  ...arr(node.selectionEntries),
  ...arr(node.sharedSelectionEntries),
  ...arr(node.selectionEntryGroups),
  ...arr(node.sharedSelectionEntryGroups),
  ...arr(node.entryLinks),
];

/**
 * One complete per-model equipment alternative of a peer. `labels` names the
 * choice taken at each defaultless required equipment group, and `choices` the
 * source entries picked there, whose own selection limits bound the alternative.
 */
export interface EquipmentAlternative {
  links: JsonNode[];
  labels: string[];
  choices: JsonNode[];
}

export interface FixedEquipment {
  alternatives: EquipmentAlternative[];
  item?: string;
  reason?: string;
}

/** Equipment multiplicity counts only per-model (`parent`-scoped) constraints; wider scopes cap models, not copies. */
const perModel = (node: JsonNode): JsonNode => ({
  ...node,
  constraints: arr(node.constraints).filter((c) => c.scope === undefined || c.scope === "parent"),
});

function fixedCopies(node: JsonNode): number | undefined {
  const min = constraint(perModel(node), "min");
  const max = constraint(perModel(node), "max");
  if (min === undefined && max === undefined) return 1;
  if (min === undefined) return max === 1 ? 1 : undefined;
  if (max === undefined) return min === 1 ? 1 : undefined;
  return min === max && min > 0 ? min : undefined;
}

const isWeaponProfile = (profile: JsonNode | undefined): boolean => / weapons$/i.test(str(profile?.typeName) ?? "");

function product(left: EquipmentAlternative[], right: EquipmentAlternative[]): EquipmentAlternative[] {
  return left.flatMap((a) => right.map((b) => ({ links: [...a.links, ...b.links], labels: [...a.labels, ...b.labels], choices: [...a.choices, ...b.choices] })));
}

/**
 * Fixed equipment of one model peer, as its complete per-model alternatives.
 * An inline upgrade entry carries its weapon either as its own profile or as an
 * infoLink to a shared profile, looked up in `sourceNodes`. A profile link that
 * resolves nowhere in the source cannot be classified, so the entry is kept and
 * left to the equipment resolver, which reports it when no repo weapon or
 * wargear matches. A required single-pick group with no default selection (no
 * `defaultSelectionEntryId`, or `"none"`) fixes one of its children, so each
 * child yields its own alternative; a defaultless optional group fixes only the
 * children it explicitly requires. An inline entry with neither is kept when
 * `isEquipment` recognises it (a vox-caster's only profile is its ability).
 */
export function fixedEquipment(
  peer: JsonNode,
  sourceNodes: ReadonlyMap<string, JsonNode>,
  isEquipment: (entry: JsonNode) => boolean = () => false,
): FixedEquipment {
  let item: string | undefined;
  let reason: string | undefined;
  const unsupported = (node: JsonNode, why: string): void => {
    item ??= str(node.name) ?? "(unnamed equipment)";
    reason ??= why;
  };
  /** A linked group as its target, carrying the link's own constraints and modifiers first. */
  const linkedGroup = (link: JsonNode): JsonNode | undefined => {
    const target = sourceNodes.get(str(link.targetId) ?? "");
    if (!target) return undefined;
    return {
      ...target,
      name: str(link.name) ?? target.name,
      constraints: [...arr(link.constraints), ...arr(target.constraints)],
      modifiers: [...arr(link.modifiers), ...arr(target.modifiers)],
    };
  };
  const asGroup = (node: JsonNode): JsonNode | undefined => {
    if (node.type === "selectionEntryGroup") return linkedGroup(node);
    return node.type === undefined ? node : undefined;
  };
  /** Every alternative of picking `option` within a choice; a group option picks one of its own children. */
  const choose = (option: JsonNode): EquipmentAlternative[] => {
    const capped = (alts: EquipmentAlternative[]): EquipmentAlternative[] => alts.map((alt) => ({ ...alt, choices: [option, ...alt.choices] }));
    const nested = asGroup(option);
    if (nested) return capped(children(nested).flatMap(choose));
    const label = str(option.name) ?? "(unnamed equipment)";
    return capped(visit(option, true).map((alt) => ({ ...alt, labels: [label, ...alt.labels] })));
  };
  const visitGroup = (group: JsonNode): EquipmentAlternative[] => {
    const none: EquipmentAlternative[] = [{ links: [], labels: [], choices: [] }];
    const defaultId = str(group.defaultSelectionEntryId);
    const options = children(group);
    const selected = defaultId && defaultId !== "none" ? options.find((candidate) => candidate.id === defaultId) : undefined;
    if (selected) return visit(selected, true);
    if (defaultId && defaultId !== "none") {
      unsupported(group, "default equipment selection is missing");
      return none;
    }
    const min = constraint(perModel(group), "min") ?? 0;
    if (min <= 0) {
      // An optional container still fixes the children it explicitly requires.
      return options
        .filter((option) => (constraint(perModel(option), "min") ?? 0) > 0)
        .reduce((result, option) => {
          const nested = asGroup(option);
          return product(result, nested ? visitGroup(nested) : visit(option, true));
        }, none);
    }
    if (min !== 1 || constraint(perModel(group), "max") !== 1) {
      unsupported(group, "required equipment choice picks more than one item");
      return none;
    }
    const alternatives = options.flatMap(choose);
    if (!alternatives.length) unsupported(group, "required equipment choice has no options");
    return alternatives.length ? alternatives : none;
  };
  const visit = (node: JsonNode, includeNode = false): EquipmentAlternative[] => {
    let result: EquipmentAlternative[] = [{ links: [], labels: [], choices: [] }];
    const add = (entry: JsonNode): void => {
      const copies = fixedCopies(entry);
      if (copies === undefined) {
        unsupported(entry, "configurable equipment multiplicity");
        return;
      }
      result = product(result, [{ links: Array.from({ length: copies }, () => entry), labels: [], choices: [] }]);
    };
    if (includeNode && node.type === "selectionEntry" && str(node.targetId)) add(node);
    else if (includeNode && arr(node.profiles).some(isWeaponProfile)) add(node);
    else if (includeNode) {
      const profileLinks = arr(node.infoLinks).filter((link) => link.type === "profile");
      const targets = profileLinks.map((link) => sourceNodes.get(str(link.targetId) ?? ""));
      if (targets.some((target) => target === undefined || isWeaponProfile(target)) || isEquipment(node)) add(node);
    }
    for (const link of arr(node.entryLinks)) {
      const min = constraint(link, "min");
      if (link.type === "selectionEntry" && (min === undefined || min > 0) && !/ upgrade$/i.test(str(link.name) ?? "")) add(link);
    }
    for (const entry of arr(node.selectionEntries)) {
      if ((constraint(entry, "min") ?? 1) <= 0) continue;
      result = product(result, visit(entry, true));
    }
    for (const link of arr(node.entryLinks)) {
      if (link.type !== "selectionEntryGroup") continue;
      const linked = linkedGroup(link);
      if (linked) result = product(result, visitGroup(linked));
      else if ((constraint(perModel(link), "min") ?? 0) > 0) unsupported(link, "required equipment group link is unresolved");
    }
    for (const group of arr(node.selectionEntryGroups)) result = product(result, visitGroup(group));
    return result;
  };
  const alternatives = visit(peer);
  return { alternatives, item, reason };
}

