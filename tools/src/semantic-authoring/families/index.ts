import { ABILITY_MODIFIERS_AND_GRANTS_FAMILIES } from "./ability-modifiers-and-grants.js";
import { ARMY_AND_DATASHEET_FAMILIES } from "./army-and-datasheet.js";
import { ATTACK_AND_ROUND_PREDICATES_FAMILIES } from "./attack-and-round-predicates.js";
import { AURAS_AND_SELECTIONS_FAMILIES } from "./auras-and-selections.js";
import { CHARACTERISTIC_CHANGES_FAMILIES } from "./characteristic-changes.js";
import { CONTAINER_OPENERS_FAMILIES } from "./container-openers.js";
import { COUNTING_QUALIFIERS_FAMILIES } from "./counting-qualifiers.js";
import { DICE_AND_DAMAGE_FAMILIES } from "./dice-and-damage.js";
import { EVENTS_FAMILIES } from "./events.js";
import { IDENTITY_AND_POSITION_PREDICATES_FAMILIES } from "./identity-and-position-predicates.js";
import { MODEL_LOSSES_AND_RETURNS_FAMILIES } from "./model-losses-and-returns.js";
import { MOVE_LIMITS_FAMILIES } from "./move-limits.js";
import { MOVES_FAMILIES } from "./moves.js";
import { NAMED_ABILITIES_FAMILIES } from "./named-abilities.js";
import { NAMED_REGIONS_FAMILIES } from "./named-regions.js";
import { ORDERS_FAMILIES } from "./orders.js";
import { PSYCHIC_AND_OATHS_FAMILIES } from "./psychic-and-oaths.js";
import { RESERVES_SCHEDULE_FAMILIES } from "./reserves-schedule.js";
import { RESOURCE_MENUS_AND_OBJECTIVES_FAMILIES } from "./resource-menus-and-objectives.js";
import { RESOURCES_AND_DESIGNATIONS_FAMILIES } from "./resources-and-designations.js";
import { RESTRICTIONS_FAMILIES } from "./restrictions.js";
import { ROLL_CHANGES_FAMILIES } from "./roll-changes.js";
import { SET_UP_AND_MARKERS_FAMILIES } from "./set-up-and-markers.js";
import { TARGETING_AND_PERMISSIONS_FAMILIES } from "./targeting-and-permissions.js";
import { TESTS_AND_DURATIONS_FAMILIES } from "./tests-and-durations.js";
import { TRANSPORT_FAMILIES } from "./transport.js";
import { UNIT_ACTIVITY_AND_POSITION_FAMILIES } from "./unit-activity-and-position.js";
import { UNIT_BUFFS_FAMILIES } from "./unit-buffs.js";
import { UNIT_CHANGES_FAMILIES } from "./unit-changes.js";
import { UNIT_COMPOSITION_PREDICATES_FAMILIES } from "./unit-composition-predicates.js";
import { UNIT_FILTER_FAMILIES } from "./unit-filter.js";
import { UNIT_STATES_AND_KEYWORDS_FAMILIES } from "./unit-states-and-keywords.js";
import { WEAPONS_AND_WARGEAR_FAMILIES } from "./weapons-and-wargear.js";
import type { FlatFamily } from "./types.js";

/**
 * Family ids in registry order. Model-facing family listings (Jev's family choices and its answer
 * cache key, the leaf-proposal context) and the seeded `semantic_families` rows follow this order,
 * so a new family is appended here rather than inserted.
 */
const FAMILY_ORDER: readonly string[] = [
  "critical-hit-threshold", "resource-action", "weapon-grant", "fights-first",
  "count-by-battle-size", "count-by-battle-round", "with-embarked-units", "stance-initial",
  "pick-exclusion", "sticky-objective", "target-binding", "optional-use", "usage-scope",
  "use-window", "activation-window", "mortal-wound-source", "fight-on-death", "dice-count-option",
  "dice-count-rolled", "end-attack-sequence", "move-end-waiver", "move-mode-choice",
  "resource-die", "stratagem-cost", "wounds-remaining", "starting-strength",
  "leaves-attached-unit", "weapon-ability-removal", "leader-target", "rules-bundle-marker",
  "order-rule", "dice-pool-allocation-open", "move-type-open", "move-type-section",
  "named-region-producer", "unit-owner", "same-unit", "wounds-state", "controls-objective",
  "attack-compare", "battle-size", "moved-over", "roll-outcome", "deployment-window",
  "menu-options-grant", "designation-once", "unit-mark", "test-exemption", "destruction-rule",
  "datasheet-swap", "characteristic-resolution", "borrow-weapons", "targeted", "risk-reward-open",
  "on-fail-open", "resource-action-menu-open", "menu-action", "persistent-designation-open",
  "select-objective-open", "objective-criterion", "destroyed-model-selection", "mark-objective",
  "opposed-designations", "psychic-level-cost", "ritual-menu-open", "ritual-manifest",
  "test-doubles", "roll-total", "model-profile", "resource", "operation-markers",
  "engagement-fronts", "destroyed-while-on-objective", "destroyed-in-tagged-terrain",
  "engagement-exclusive", "condition-exclusion", "otherwise", "weapon-has-ability",
  "army-includes", "history-window", "manoeuvre-own-roll", "by-ability", "ability-used",
  "granted-ability-name", "named-ability-definition", "named-ability-definition-end",
  "named-ability-grant", "named-ability-exchange", "named-ability-suppression",
  "resource-before-ability-determination", "oath-determine", "oath-fulfilled",
  "oath-selection-history", "oath-duplicate-result", "oath-exhaustion", "oath-quality-persistence",
  "oath-deed-reward", "oath-reward-selection", "ability-use-history",
  "ability-selection-override", "army-state", "scale-cap", "characteristic-amount", "named-weapon",
  "unit-wargear", "additive-option", "ignore-modifier-list", "embarked-permission",
  "move-passthrough-used", "named-range-value", "named-range-cap", "count-by-markers", "test",
  "guided", "weapon-ability-range", "battle-round", "phase-window", "instead",
  "chosen-option-grant", "stance-selection-capacity", "damage-reduction", "visible",
  "act-after-move", "army-faction", "weapon-ability-keyword", "select-weapon", "counts-as",
  "eligible", "membership", "unit-size", "optional-cost-paid", "hit-by-attacks", "move-must-end",
  "invulnerable-save", "count-scale", "move-end-nearest", "roll-prohibition", "unit-state",
  "no-advance-roll", "named-region-state", "rule-active", "aura-emitter", "aura-range",
  "destroy-models", "feel-no-pain", "keyword-grant", "leading-unit", "loadout", "model-count",
  "move-through", "returned-model-exclusion", "stratagem-target", "triggering-target",
  "characteristic-floor", "ability-modifier", "counts-as-moved", "ignore-modifiers", "rule-state",
  "select-unit", "make-move", "eligibility-permission", "duration", "ability-activate",
  "resource-spend", "reserves-arrival", "weapon-ability-grant", "battlefield-marker",
  "unit-has-ability", "issue-orders-open", "unit-keyword", "unit-position", "dice-roll", "attack",
  "roll-result", "roll-modifier", "mortal-wounds", "roll-auto-result", "battle-shock-state",
  "choice-open", "stance-select-open", "history-compare", "named-option", "unit-filter",
  "core-ability-grant", "reroll", "unit-activity", "move-distance", "transport-capacity",
  "weapon-property-scope", "equipped-weapon-count", "bearer-eligibility", "split-unit", "set-up",
  "targeting-restriction", "in-region", "resource-gain", "army-construction",
  "ability-record-grant", "characteristic-set", "usage-limit", "attack-filter",
  "characteristic-modifier", "event", "turn-start", "add-unit", "target-is-selected",
  "regain-wounds", "return-models", "for-each-unit-select", "apply-mark", "designated-filter",
  "orders-modifier", "order-share",
  "game-mode", "reserves-schedule", "region-extend", "area-select",
];

const ALL: readonly FlatFamily[] = [
  ...ABILITY_MODIFIERS_AND_GRANTS_FAMILIES,
  ...ARMY_AND_DATASHEET_FAMILIES,
  ...ATTACK_AND_ROUND_PREDICATES_FAMILIES,
  ...AURAS_AND_SELECTIONS_FAMILIES,
  ...CHARACTERISTIC_CHANGES_FAMILIES,
  ...CONTAINER_OPENERS_FAMILIES,
  ...COUNTING_QUALIFIERS_FAMILIES,
  ...DICE_AND_DAMAGE_FAMILIES,
  ...EVENTS_FAMILIES,
  ...IDENTITY_AND_POSITION_PREDICATES_FAMILIES,
  ...MODEL_LOSSES_AND_RETURNS_FAMILIES,
  ...MOVE_LIMITS_FAMILIES,
  ...MOVES_FAMILIES,
  ...NAMED_ABILITIES_FAMILIES,
  ...NAMED_REGIONS_FAMILIES,
  ...ORDERS_FAMILIES,
  ...PSYCHIC_AND_OATHS_FAMILIES,
  ...RESERVES_SCHEDULE_FAMILIES,
  ...RESOURCE_MENUS_AND_OBJECTIVES_FAMILIES,
  ...RESOURCES_AND_DESIGNATIONS_FAMILIES,
  ...RESTRICTIONS_FAMILIES,
  ...ROLL_CHANGES_FAMILIES,
  ...SET_UP_AND_MARKERS_FAMILIES,
  ...TARGETING_AND_PERMISSIONS_FAMILIES,
  ...TESTS_AND_DURATIONS_FAMILIES,
  ...TRANSPORT_FAMILIES,
  ...UNIT_ACTIVITY_AND_POSITION_FAMILIES,
  ...UNIT_BUFFS_FAMILIES,
  ...UNIT_CHANGES_FAMILIES,
  ...UNIT_COMPOSITION_PREDICATES_FAMILIES,
  ...UNIT_FILTER_FAMILIES,
  ...UNIT_STATES_AND_KEYWORDS_FAMILIES,
  ...WEAPONS_AND_WARGEAR_FAMILIES,
];

function ordered(): readonly FlatFamily[] {
  const byId = new Map<string, FlatFamily>();
  for (const family of ALL) {
    if (byId.has(family.id)) throw new Error(`Semantic family ${family.id} is defined twice.`);
    byId.set(family.id, family);
  }
  const unordered = [...byId.keys()].filter((id) => !FAMILY_ORDER.includes(id));
  if (unordered.length) throw new Error(`Semantic families missing from FAMILY_ORDER: ${unordered.join(", ")}.`);
  return FAMILY_ORDER.map((id) => {
    const family = byId.get(id);
    if (!family) throw new Error(`FAMILY_ORDER names ${id}, which no family defines.`);
    return family;
  });
}

/** Every reviewed semantic family, one definition each, in registry order. */
export const FAMILIES: readonly FlatFamily[] = ordered();
