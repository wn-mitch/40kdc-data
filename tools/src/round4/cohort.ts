export interface CohortSpec {
  faction_id: string;
  ability_id: string;
  primary_stratum: string;
  secondary_family_tags: string[];
}

const row = (
  faction_id: string,
  ability_id: string,
  primary_stratum: string,
  secondary_family_tags: string[],
): CohortSpec => ({ faction_id, ability_id, primary_stratum, secondary_family_tags });

export const ROUND4_COHORT: readonly CohortSpec[] = [
  row("world-eaters", "helm-of-brazen-ire-berzerker-warband", "trusted-anchor", ["attack", "magnitude", "allocation"]),
  row("world-eaters", "hack-and-slash-berzerker-warband", "trusted-anchor", ["duration", "property", "condition"]),
  row("world-eaters", "relentless-rage", "trusted-anchor", ["event", "duration", "sequence"]),
  row("core", "deep-strike", "trusted-anchor", ["predicate", "spatial", "reference"]),
  row("agents-of-the-imperium", "malus-codicium", "dice-heavy", ["property", "condition", "magnitude"]),
  row("adeptus-mechanicus", "bomb-rack", "dice-heavy", ["dice", "iteration", "threshold"]),
  row("aeldari", "blitz", "dice-heavy", ["dice", "duration", "usage"]),
  row("adepta-sororitas", "acts-of-faith", "dice-heavy", ["dice", "resource", "replacement", "sequence"]),
  row("adepta-sororitas", "triptych-of-judgement-champions-of-faith", "attack-combat-modifier", ["attack", "choice", "immunity"]),
  row("adeptus-titanicus", "titanic-fire-support", "attack-combat-modifier", ["critical", "attack", "duration"]),
  row("aeldari", "tactical-acumen", "attack-combat-modifier", ["movement", "restriction", "duration"]),
  row("adeptus-custodes", "stand-vigil", "attack-combat-modifier", ["reroll", "replacement", "objective"]),
  row("adepta-sororitas", "shield-of-aversion-bringers-of-flame", "condition-guard", ["attack", "duration", "property"]),
  row("adeptus-astartes", "vehement-aggression", "condition-guard", ["test", "branch", "reroll"]),
  row("aeldari", "death-is-not-enough", "condition-guard", ["history", "test", "modifier"]),
  row("agents-of-the-imperium", "orbital-oversight-veiled-blade-elimination-force", "condition-guard", ["spatial", "exception", "attack"]),
  row("adepta-sororitas", "hagiomnifex-upgrade-sanctified-orators", "menu-choice", ["choice", "usage", "option-local"]),
  row("adepta-sororitas", "mysterious-saviours", "menu-choice", ["permission", "resource", "reuse"]),
  row("adeptus-mechanicus", "doctrina-imperatives", "menu-choice", ["choice", "duration", "option-local"]),
  row("aeldari", "acrobatic-grace", "menu-choice", ["attack", "modifier"]),
  row("aeldari", "monofilament-snare", "iteration-binding", ["iteration", "binding", "dice"]),
  row("adeptus-astartes", "righteous-zeal", "iteration-binding", ["movement", "dice", "guard"]),
  row("adepta-sororitas", "bastion-of-faith-champions-of-faith", "iteration-binding", ["attachment", "binding", "attack"]),
  row("adeptus-custodes", "saturation-volleys", "duration-trigger", ["state", "duration", "attack"]),
  row("adepta-sororitas", "righteous-purpose", "duration-trigger", ["selection", "duration", "property"]),
  row("agents-of-the-imperium", "gaze-into-the-empyrean-psychic", "duration-trigger", ["spatial", "restriction", "event"]),
  row("adepta-sororitas", "sanctified-amulet-champions-of-faith", "spatial-reference", ["spatial", "reference", "restriction"]),
  row("adeptus-astartes", "fire-support", "spatial-reference", ["history", "reference", "attack"]),
  row("adeptus-astartes", "fleet-commander-anvil-siege-force", "spatial-reference", ["spatial", "sequence", "dice"]),
  row("adepta-sororitas", "divine-intervention-hallowed-martyrs", "replacement-resource-multi-step", ["resource", "sequence", "restoration"]),
  row("adepta-sororitas", "solemn-procession", "replacement-resource-multi-step", ["replacement", "dice", "automatic-result"]),
  row("adeptus-astartes", "rites-of-battle", "replacement-resource-multi-step", ["resource", "usage", "event"]),
] as const;
