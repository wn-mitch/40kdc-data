import type { Dataset } from "../data/dataset.js";
import type { StackMember } from "./model.js";

/** The most member variants one stack expands to; more means a group the search cannot price, so it refuses. */
const MAX_VARIANTS = 1024;

/** A member's own keywords: its datasheet and faction keywords and the keyword-choice options it took. */
export function ownKeywords(member: StackMember): string[] {
  return [...member.unit.keywords, ...member.unit.factionKeywords, ...(member.chosen ?? [])];
}

/** A member's identity in a stack, including the options it took, for cache keys. */
export function memberKey(member: StackMember): string {
  return member.chosen && member.chosen.length > 0 ? `${member.unit.id}[${member.chosen.join(",")}]` : member.unit.id;
}

/**
 * The options a unit can take in an army with `detachmentIds`: for each keyword-choice group that
 * applies (no detachment, or one of them), its option keywords, plus none when the group is not mandatory.
 */
function memberOptions(dataset: Dataset, member: StackMember, detachmentIds: readonly string[]): string[][] {
  const byGroup = new Map<string, string[]>();
  for (const entry of member.unit.raw.conditional_keywords ?? []) {
    if (!entry.choice_group) continue;
    const group = dataset.keywordChoiceGroups.get(entry.choice_group);
    if (!group || (group.detachment_id !== null && !detachmentIds.includes(group.detachment_id))) continue;
    (byGroup.get(group.id) ?? byGroup.set(group.id, []).get(group.id)!).push(entry.keyword);
  }
  let variants: string[][] = [[]];
  for (const [groupId, keywords] of [...byGroup].sort(([left], [right]) => left.localeCompare(right))) {
    const mandatory = dataset.keywordChoiceGroups.get(groupId)!.mandatory;
    const picks: (string | null)[] = [...(mandatory ? [] : [null]), ...[...keywords].sort()];
    variants = variants.flatMap((taken) => picks.map((pick) => (pick === null ? taken : [...taken, pick])));
  }
  return variants;
}

/**
 * Every way the members can take their keyword-choice options (a Mark of Chaos each) in an army with
 * `detachmentIds`: one member list per combination, each member carrying the options it took. Members
 * with no options appear once, unchanged.
 */
export function choiceVariants(dataset: Dataset, members: readonly StackMember[], detachmentIds: readonly string[]): StackMember[][] {
  let variants: StackMember[][] = [[]];
  for (const member of members) {
    const options = memberOptions(dataset, member, detachmentIds);
    variants = variants.flatMap((taken) => options.map((chosen) => [...taken, chosen.length > 0 ? { ...member, chosen } : { ...member, chosen: undefined }]));
    if (variants.length > MAX_VARIANTS) throw new Error(`A stack has more than ${MAX_VARIANTS} keyword-choice variants; the search cannot price them all.`);
  }
  return variants;
}
