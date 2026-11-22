/**
 * Parameter values and checks the compiler shares with the family definitions. Each names a value
 * a leaf's parameters can hold, so compile code and family definitions agree on one spelling.
 */

/** Weapon abilities a characteristic change can be limited to ("Torrent weapons equipped by …"). */
export const WEAPON_KEYWORDS = [
  "Assault", "Blast", "Devastating Wounds", "Hazardous", "Heavy", "Ignores Cover", "Indirect Fire", "Lance", "Lethal Hits",
  "Melta", "One Shot", "Pistol", "Precision", "Psychic", "Rapid Fire", "Sustained Hits", "Torrent", "Twin-linked",
] as const;

/** A distance or engagement whose other unit is the unit-filter right after the leaf. */
export const FOLLOWING_FILTER = "following-filter";

/** Keys whose value following-filter names the unit-filter right after the leaf. */
const FOLLOWING_FILTER_KEYS = ["of", "with", "object", "target", "by", "to", "into"] as const;

/** Whether a leaf names the unit-filter right after it (a distance's, engagement's or targeting's other unit). */
export function awaitsFollowingFilter(parameters: Record<string, unknown>): boolean {
  return FOLLOWING_FILTER_KEYS.some((key) => parameters[key] === FOLLOWING_FILTER);
}

/** A unit-filter or targeting-restriction that names the matched set ("those VEHICLE units"). */
export const MATCHED_UNITS = "matched-units";

/** A kebab-case entity id: an enrichment ability record, a core Stratagem or a menu action. */
export const NAMED_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/u;

/** A named entity id, or a TypeError naming the key. */
export function namedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !NAMED_ID.test(value)) throw new TypeError(`${label} is a kebab-case ability, Stratagem, manoeuvre or action id.`);
  return value;
}

/** Activities a `used` moment can name one member of. Dark Pacts, Acts of Faith, Rituals and the rest are named only as a kind. */
export const NAMED_ACTIVITIES = ["ability", "manoeuvre", "stratagem", "action"] as const;

/** The unit-filter role flag: the filter names models whose attacks an attack frame before it excludes. */
export const EXCLUDED_FROM_ATTACKS = "attacks";

/** The only subject a unit-filter takes. */
export const FILTER_SUBJECT_TARGET = "target";

/** A unit-filter that picks among the Stratagem's own targets rather than among all units. */
export const AMONG_TARGETS = "stratagem-targets";

/** The Transport a disembarked moment's unit came out of (compile-disembark-moment.ts). */
export const DISEMBARKED_FROM = "disembarked-from";

/** The unit-activity that says a unit was targeted with the Stratagems named in stratagem_ids this phase. */
export const TARGETED_WITH_STRATAGEM = "targeted-with-stratagem-this-phase";

/**
 * The unit-activities that name units or models the triggering attacks destroyed. A destruction
 * leaf takes no subject. Lowering: compile-triggering-destruction.ts.
 */
export const DESTRUCTION_ACTIVITIES = ["destroyed-units-by-triggering-attacks", "destroyed-models-by-triggering-attacks"] as const;

/** The activity: the subject destroyed the Stratagem's target. */
export const DESTROYED_STRATAGEM_TARGET = "destroyed-stratagem-target";

/** The activity: the subject destroyed units within a history window. */
export const WINDOWED_DESTRUCTION = "destroyed-units-in-window";

/** Rules about the units a group names: the group is the rule's subject (its DSL target). */
export const ARMY_SUBJECT_RULES = ["warlord-required", "warlord-forbidden", "warlord-allowed", "enhancement-forbidden", "enhancement-source", "limit-exemption"] as const;

/** Every model from the controlling player's army. */
export const ARMY_MODELS = "army-models";

/** The family that names an ability a leaf grants. */
export const GRANTED_ABILITY_NAME = "granted-ability-name";

/** The membership value that names the unit a moment names (compile-antecedent.ts binds it). */
export const MOMENT_UNIT = "antecedent";

/** Owner-qualified phase edges: "until the end of your next Fight phase" and similar. */
export const PHASE_EDGE_ENDPOINTS: readonly string[] = ["end-of-next-phase", "start-of-next-phase"];

/**
 * The attack-filter fields "those attacks" can carry beside `of`. A shooting moment's attacks
 * are ranged by definition, so only attack_type ranged may restate it; any other field would
 * narrow the bound attacks in a way the DSL's event reference cannot say.
 */
export function boundAttacksProblem(parameters: Record<string, unknown>): string | null {
  const extra = Object.keys(parameters).filter((key) => key !== "of" && key !== "attack_type");
  if (extra.length) return `attack-filter of antecedent names the attacks of an earlier shooting moment; ${extra.join(", ")} cannot narrow them.`;
  if (parameters.attack_type !== undefined && parameters.attack_type !== "ranged") {
    return `attack-filter of antecedent names the attacks of an earlier shooting moment, which are ranged, not ${String(parameters.attack_type)}.`;
  }
  return null;
}

/** Units an effect's own recipient can be: the unit a trigger names. */
export const EVENT_SUBJECT = "event-subject";

/** Event kinds general enough to take an owner (whose unit). */
export const OWNED_EVENT_KINDS = ["move-ended", "selected", "targets-selected", "attacks-resolved", "set-up"] as const;

/** Weapon characteristics: the ones a change can limit to melee or ranged. */
export const WEAPON_CHARACTERISTICS = ["A", "WS", "BS", "S", "AP", "D"] as const;

/** The faces of each die a dice leaf rolls. */
export const DICE_FACES: Record<string, number> = { D3: 3, D6: 6, "2D6": 12 };

/**
 * The roll kinds the re-roll, ignore-modifiers and roll-auto-result families share: every roll
 * named in authored data plus the DSL's own `roll` enum members those families have a use for.
 */
export const ROLL_KINDS = [
  "hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage",
  "attacks", "psychic", "surge", "hazard", "any", "resource-die", "blessings-of-khorne",
  "desperate-escape", "deadly-demise", "all",
] as const;

/**
 * The roll identities reviewed event leaves can name. Wildcards `any` and `all` are roll
 * selectors, never event identities. Canonical order: a list of kinds lowers to triggers in this order.
 */
export const TRIGGER_ROLL_KINDS = [
  "hit", "wound", "save", "damage", "charge", "advance", "battle-shock", "leadership", "hazard",
  "psychic", "desperate-escape", "blessings-of-khorne", "deadly-demise", "channelling",
] as const;

/** A psychic ability's cost in its heading (compile-psychic-cost.ts). */
export const PSYCHIC_COST_FAMILY = "psychic-level-cost";

/** Ritual families (compile-ritual-menu.ts). */
export const RITUAL_MENU_OPEN = "ritual-menu-open";
export const RITUAL_MANIFEST = "ritual-manifest";
export const TEST_DOUBLES = "test-doubles";
/** The roll a ritual-menu binds its Psychic test to, which a Ritual's roll-total reads. */
export const PSYCHIC_TEST_ROLL = "psychic-test";

/** Named-ability state families (compile-named-ability-states.ts). */
export const NAMED_ABILITY_DEFINITION = "named-ability-definition";
export const NAMED_ABILITY_DEFINITION_END = "named-ability-definition-end";
export const RESOURCE_BEFORE_ABILITIES = "resource-before-ability-determination";

const WINDOW_PHASES = ["command", "movement", "shooting", "charge", "fight"] as const;

/** A frequency in the DSL's spelling, with ownership only when the leaf explicitly records it. */
export function usageFor(parameters: Record<string, unknown>): Record<string, unknown> {
  // Once per battle for each copy of the wargear that carries the ability: the count is the unit's loadout.
  const frequency = parameters.count_from !== undefined ? { frequency: "n-per-battle", count_from: parameters.count_from }
    : parameters.frequency === "once-per-battle" ? { frequency: "n-per-battle", count: 1 }
    : parameters.frequency === "twice-per-battle" ? { frequency: "n-per-battle", count: 2 } : { frequency: parameters.frequency };
  return { ...frequency, ...(parameters.per !== undefined && parameters.per !== "any" ? { per: parameters.per } : {}) };
}

/** What core must say for a use-window: the same phases, and one turn when every phase has one owner. */
export function expectedWindow(parameters: Record<string, unknown>): { phases: string[]; player_turn: string } {
  const your = parameters.your_phases as string[];
  const opponent = parameters.opponent_phases as string[];
  const either = parameters.either_phases as string[];
  const phases = WINDOW_PHASES.filter((phase) => [...your, ...opponent, ...either].includes(phase));
  const player_turn = either.length === 0 && opponent.length === 0 ? "your-turn" : either.length === 0 && your.length === 0 ? "opponent-turn" : "either";
  return { phases, player_turn };
}

/** Fold for name comparison: NFKC, lowercase, every dash to "-", curly apostrophes straight, spaces collapsed. */
export function foldName(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—―]/gu, "-").replace(/[‘’]/gu, "'").replace(/\s+/gu, " ").trim();
}
