import unitKeywordCatalog from "../../../data/core/unit-keywords.json";
import type { CutoverContext, Node } from "./vocab-cutover-types.js";

const DESIGNATIONS: Record<string, true> = { afflicted: true, marked: true, suppressed: true };
// Owner-bound source identifies these as model/unit keywords, not weapon abilities.
const keywordCorrections: Record<string, string> = {
  "chaos-space-marines/cybinfernal-font-cult-of-the-arkifane-chaos-space-marines/effect": "SOUL FORGE",
  "genestealer-cults/killer-reputation-genestealer-cults/effect/steps/0/effect": "KILLER",
};
const object = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);

/** Correct a mechanically explicit non-weapon grant without interpreting ambiguous source text. */
export function transformGrantCategories(node: Node, ctx: CutoverContext): Node {
  if (node.type !== "weapon-ability-grant" || !object(node.modifier) || !Array.isArray(node.modifier.abilities)) return node;
  const modifier = node.modifier;
  const effects: Node[] = [];
  const weaponAbilities: unknown[] = [];
  for (const value of modifier.abilities as unknown[]) {
    if (typeof value !== "string") { weaponAbilities.push(value); continue; }
    const normalized = value.toLowerCase().replace(/[’']/g, "").replace(/[\s_]+/g, "-");
    const critical = /^critical[- ](hits|wounds)[- ]([2-6])(?:\+|PLUS)?$/i.exec(value);
    if (critical) {
      const { abilities: _abilities, ...rest } = modifier;
      effects.push({ type: "roll-result", target: node.target, modifier: { ...rest, roll: critical[1]!.toLowerCase() === "hits" ? "hit" : "wound", critical_on: Number(critical[2]) } });
      continue;
    }
    const rating = /^(.*?)-(\d+)$/.exec(normalized);
    const id = rating?.[1] ?? normalized;
    const ability = unitKeywordCatalog.find((entry) => entry.id === id);
    const correctedKeyword = keywordCorrections[`${ctx.faction}/${ctx.record}${ctx.pointer}`];
    const unitKeyword = ctx.unitKeywords?.get(value.replaceAll("’", "'").toUpperCase()) ?? (correctedKeyword === value.toUpperCase() ? correctedKeyword : undefined);
    const designation = DESIGNATIONS[normalized];
    if (!ability && !unitKeyword && !designation && normalized !== "benefit-of-cover" && normalized !== "explosives") { weaponAbilities.push(value); continue; }
    if (Object.keys(modifier).some((key) => key !== "abilities")) {
      ctx.report("non-weapon grant has modifier restrictions requiring source-backed recipient placement", value);
      weaponAbilities.push(value);
      continue;
    }
    if (ability && ability.required_parameters.length && !rating) {
      ctx.report("ordinary ability grant is missing its required value", value);
      weaponAbilities.push(value);
      continue;
    }
    if (unitKeyword) effects.push({ type: "keyword-grant", target: node.target, modifier: { keywords: [value.toUpperCase()] } });
    else if (designation) effects.push({ type: "designate", target: node.target, modifier: { subject: node.target, tag: normalized } });
    else effects.push({ type: "ability-grant", target: node.target, modifier: { ability: ability?.id ?? normalized, ...(rating ? { value: Number(rating[2]) } : {}) } });
  }
  if (!effects.length) return node;
  if (weaponAbilities.length) effects.unshift({ ...node, modifier: { ...modifier, abilities: weaponAbilities } });
  if (effects.length === 1) return { ...node, ...effects[0] };
  const { type: _type, target: _target, modifier: _modifier, ...rest } = node;
  if (Object.keys(rest).length) {
    ctx.report("mixed grant categories carry outer properties requiring explicit placement", node);
    return node;
  }
  return { type: "sequence", steps: effects };
}
