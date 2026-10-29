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
  row("world-eaters", "helm-of-brazen-ire-berzerker-warband-world-eaters", "trusted-anchor", ["attack", "magnitude", "allocation"]),
  row("world-eaters", "hack-and-slash-berzerker-warband-world-eaters", "trusted-anchor", ["duration", "property", "condition"]),
  row("world-eaters", "relentless-rage-world-eaters", "trusted-anchor", ["event", "duration", "sequence"]),
  row("core", "deep-strike", "trusted-anchor", ["predicate", "spatial", "reference"]),
  row("agents-of-the-imperium", "malus-codicium", "dice-heavy", ["property", "condition", "magnitude"]),
  row("adeptus-mechanicus", "bomb-rack-adeptus-mechanicus", "dice-heavy", ["dice", "iteration", "threshold"]),
  row("aeldari", "blitz", "dice-heavy", ["dice", "duration", "usage"]),
  row("adepta-sororitas", "acts-of-faith-adepta-sororitas", "dice-heavy", ["dice", "resource", "replacement", "sequence"]),
  row("adepta-sororitas", "triptych-of-judgement-champions-of-faith-adepta-sororitas", "attack-combat-modifier", ["attack", "choice", "immunity"]),
  row("adeptus-titanicus", "titanic-fire-support", "attack-combat-modifier", ["critical", "attack", "duration"]),
  row("aeldari", "tactical-acumen-aeldari", "attack-combat-modifier", ["movement", "restriction", "duration"]),
  row("adeptus-custodes", "stand-vigil-adeptus-custodes", "attack-combat-modifier", ["reroll", "replacement", "objective"]),
  row("adepta-sororitas", "shield-of-aversion-bringers-of-flame-adepta-sororitas", "condition-guard", ["attack", "duration", "property"]),
  row("adeptus-astartes", "vehement-aggression-black-templars", "condition-guard", ["test", "branch", "reroll"]),
  row("aeldari", "death-is-not-enough-aeldari", "condition-guard", ["history", "test", "modifier"]),
  row("agents-of-the-imperium", "orbital-oversight-veiled-blade-elimination-force-agents-of-the-imperium", "condition-guard", ["spatial", "exception", "attack"]),
  row("adepta-sororitas", "hagiomnifex-upgrade-sanctified-orators-adepta-sororitas", "menu-choice", ["choice", "usage", "option-local"]),
  row("adepta-sororitas", "mysterious-saviours-adepta-sororitas", "menu-choice", ["permission", "resource", "reuse"]),
  row("adeptus-mechanicus", "doctrina-imperatives-adeptus-mechanicus", "menu-choice", ["choice", "duration", "option-local"]),
  row("aeldari", "acrobatic-grace-aeldari", "menu-choice", ["attack", "modifier"]),
  row("aeldari", "monofilament-snare-aeldari", "iteration-binding", ["iteration", "binding", "dice"]),
  row("adeptus-astartes", "righteous-zeal-black-templars", "iteration-binding", ["movement", "dice", "guard"]),
  row("adepta-sororitas", "bastion-of-faith-champions-of-faith-adepta-sororitas", "iteration-binding", ["attachment", "binding", "attack"]),
  row("adeptus-custodes", "saturation-volleys-adeptus-custodes", "duration-trigger", ["state", "duration", "attack"]),
  row("adepta-sororitas", "righteous-purpose-adepta-sororitas", "duration-trigger", ["selection", "duration", "property"]),
  row("agents-of-the-imperium", "gaze-into-the-empyrean-agents-of-the-imperium", "duration-trigger", ["spatial", "restriction", "event"]),
  row("adepta-sororitas", "sanctified-amulet-champions-of-faith-adepta-sororitas", "spatial-reference", ["spatial", "reference", "restriction"]),
  row("adeptus-astartes", "fire-support", "spatial-reference", ["history", "reference", "attack"]),
  row("adeptus-astartes", "fleet-commander-anvil-siege-force-adeptus-astartes", "spatial-reference", ["spatial", "sequence", "dice"]),
  row("adepta-sororitas", "divine-intervention-hallowed-martyrs-adepta-sororitas", "replacement-resource-multi-step", ["resource", "sequence", "restoration"]),
  row("adepta-sororitas", "solemn-procession-adepta-sororitas", "replacement-resource-multi-step", ["replacement", "dice", "automatic-result"]),
  row("adeptus-astartes", "rites-of-battle", "replacement-resource-multi-step", ["resource", "usage", "event"]),
] as const;
