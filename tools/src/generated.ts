/* Generated from crates/wh40kdc/schemas/bundled.schema.json by 'npm run codegen:types'. DO NOT EDIT BY HAND. */

/**
 * Kebab-case identifier
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "entity-id".
 */
export type EntityId = string;
/**
 * Game edition, e.g. '10th' or '11'
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "edition".
 */
export type Edition = string;
/**
 * Dataslate version: a quarterly tag (e.g. '2025-q3') or a named kebab-case slug for non-quarterly slates (e.g. 'pre-launch-provisional')
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "dataslate-version".
 */
export type DataslateVersion = string;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "keyword".
 */
export type Keyword = string;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "keyword-list".
 */
export type KeywordList = Keyword[];
/**
 * A stat that can be a fixed number or a dice expression
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "stat-value".
 */
export type StatValue = number | string;
/**
 * GitHub handle or '40kdc-community'
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "contributor-ref".
 */
export type ContributorRef = string;
/**
 * Known external source identities. More than one id per namespace and cross-entity fan-out are valid.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "external-reference-list".
 */
export type ExternalReferenceList = ExternalReference[];
/**
 * The five official game phases. Unchanged between 10th and 11th edition — 11e reorders Pile In timing within the Fight phase but adds no top-level phase.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "phase".
 */
export type Phase = "command" | "movement" | "shooting" | "charge" | "fight";
/**
 * @minItems 1
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "phase-list".
 */
export type PhaseList = [Phase, ...Phase[]];
/**
 * Type of game element that is the source of an enrichment entry
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "source-type".
 */
export type SourceType = "ability" | "stratagem" | "enhancement" | "detachment-rule" | "faction-rule";
/**
 * Which player's turn this applies during
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "player-turn".
 */
export type PlayerTurn = "your-turn" | "opponent-turn" | "either";
/**
 * The event families a trigger fires on and a `happened` condition looks back at. Each family takes typed parameters in the trigger's `filter` (which move, which roll, which Stratagem) and names who acted (`subject`) and what it was aimed at (`object`), so an event name never packs a subject or object.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "game-event".
 */
export type GameEvent =
  | "battle-started"
  | "battle-formations-declared"
  | "deployment-ended"
  | "round-started"
  | "round-ended"
  | "turn-started"
  | "turn-ended"
  | "phase-started"
  | "phase-ended"
  | "step-started"
  | "selected"
  | "targets-selected"
  | "move-ended"
  | "set-up"
  | "disembarked"
  | "before-roll"
  | "after-roll"
  | "damage-allocated"
  | "attacks-resolved"
  | "destroyed"
  | "model-destroyed"
  | "used"
  | "state-changed"
  | "designation-changed"
  | "designation-resolved"
  | "marker-removed"
  | "objective-gained"
  | "resource-gained"
  | "resource-spent";
/**
 * 11e battle size, which sets the army's points limit and detachment-point budget: 'incursion' = 1000 pts / 2 detachment points; 'strike-force' = 2000 pts / 3 detachment points.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "battle-size".
 */
export type BattleSize = "incursion" | "strike-force";
/**
 * One of the five confirmed 11e launch Force Dispositions. Shared by force-disposition entities and the mission-matchup matrix.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "force-disposition-id".
 */
export type ForceDispositionId =
  | "take-and-hold"
  | "disruption"
  | "purge-the-foe"
  | "priority-assets"
  | "reconnaissance";
/**
 * The game mode an army-construction entity is legal or authored for, parallel to the game_version edition axis. 'matched-play' is the competitive default: when an entity omits `game_modes`, treat it as matched-play only. 'combat-patrol', 'boarding-actions', and 'crusade' are non-competitive modes; of these only combat-patrol currently has an ingest source and coverage measurement (the others are schema-homed for hand-authoring).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "game-mode-id".
 */
export type GameModeId = "matched-play" | "combat-patrol" | "boarding-actions" | "crusade";
/**
 * Game modes this entity is legal or authored for. Absent implies ['matched-play'] (the competitive default), so existing matched-play entities need not carry the field.
 *
 * @minItems 1
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "game-modes".
 */
export type GameModes = [GameModeId, ...GameModeId[]];
/**
 * A terrain piece's 2D footprint in local inches (y-down): an axis-aligned rectangle with its min corner at the local origin, a right triangle with the right angle at the local origin and legs along +x/+y, or an explicit polygon (>= 3 points). The placement resolver re-centers the footprint on its polygon area centroid, so the local-origin convention does not affect where the piece lands — only its shape matters.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "footprint".
 */
export type Footprint =
  | {
      type: "rectangle";
      width: number;
      height: number;
    }
  | {
      type: "right-triangle";
      width: number;
      height: number;
    }
  | {
      type: "polygon";
      /**
       * @minItems 3
       */
      points: [Vec2, Vec2, Vec2, ...Vec2[]];
    };
/**
 * An 11e terrain-area keyword. Confirmed launch set; extend as further keywords publish on dataslate.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "terrain-area-keyword".
 */
export type TerrainAreaKeyword = "obscuring" | "hidden" | "plunging-fire";
/**
 * Which player a unit, objective or resource belongs to.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "owner".
 */
export type Owner = "friendly" | "enemy" | "any";
/**
 * Core-rules states a unit is in. Each state's opposite is the state under `not` (unengaged is not engaged).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "unit-state".
 */
export type UnitState =
  | "engaged"
  | "battle-shocked"
  | "embarked"
  | "in-strategic-reserves"
  | "on-battlefield"
  | "hidden"
  | "fights-first"
  | "benefit-of-cover";
/**
 * One reference for every distance.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "range-ref".
 */
export type RangeRef =
  | {
      inches: number;
    }
  | ("engagement" | "aura" | "weapon" | "half-weapon" | "detection" | "objective-control")
  | {
      aura_of: EntityId;
    };
/**
 * Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "unit-ref".
 */
export type UnitRef =
  | (
      | "this-unit"
      | "this-model"
      | "model-in-this-unit"
      | "attacker"
      | "defender"
      | "event-subject"
      | "event-object"
      | "stratagem-target"
      | "selected-unit"
      | "recipient"
      | "bearer-transport"
      | "ability-unit"
    )
  | UnitFilter
  | {
      event_var: string;
    }
  | {
      selection_var: string;
    }
  | {
      stratagem_target: EntityId;
    };
/**
 * How far back a history condition looks. event: during the triggering event (this attack, this move).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "history-window".
 */
export type HistoryWindow = "phase" | "turn" | "round" | "battle" | "previous-turn" | "event";
/**
 * A designation (a tag an effect applies: spotted, observer, afflicted, riled-up). Kebab-case id; the describer prints the rules' term from its label table and integrity rejects ids outside the registry. Upper-case legacy spellings are accepted until the record repair normalises them.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "designation-id".
 */
export type DesignationId = string;
/**
 * A region of the battlefield.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "region-ref".
 */
export type RegionRef =
  | {
      territory:
        | "your-territory"
        | "enemy-territory"
        | "no-mans-land"
        | "your-deployment-zone"
        | "enemy-deployment-zone"
        | "attacker-territory";
    }
  | {
      terrain_area: {
        designated?: DesignationId;
        footprint?: string;
      };
    }
  | {
      rule_region: {
        region_id: EntityId;
        owner_faction?: EntityId;
      };
    };
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "roll-kind".
 */
export type RollKind =
  | (
      | "hit"
      | "wound"
      | "save"
      | "damage"
      | "charge"
      | "advance"
      | "battle-shock"
      | "leadership"
      | "hazard"
      | "psychic"
      | "desperate-escape"
      | "dark-pact"
      | "blessings-of-khorne"
      | "manoeuvre"
      | "channelling"
    )
  | AbilityRoll;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "roll-outcome".
 */
export type RollOutcome = "success" | "failure" | "critical";
/**
 * What a count or a scaling block counts. models-embarked-in-bearer: passengers only. embarked-models-oc: the summed Objective Control of the passengers. models-equipped-with: models in the bearer's unit equipped with `wargear`. battle-round: the current battle round number.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "scaling-source".
 */
export type ScalingSource =
  | "enemy-models-in-range"
  | "friendly-models-in-range"
  | "models-in-bearer-unit"
  | "models-in-or-embarked-in-bearer"
  | "models-embarked-in-bearer"
  | "embarked-models-oc"
  | "models-equipped-with"
  | "enemy-units-in-range"
  | "wounds-lost"
  | "battle-round";
/**
 * A count, amount or value: a number, a dice expression (D3, 2D6, D6+1), one value per battle size, the result of a bound roll, or a count of something on the battlefield, or the rating the unit prints for this rule.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "quantity".
 */
export type Quantity = number | string | BattleSizeValue | RollReference | CountOf | UnitRating;
/**
 * A move type's named mode: a Fall Back's ordered retreat or desperate escape, a rapid, combat, assault or emergency disembarkation.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "move-mode".
 */
export type MoveMode =
  | "ordered-retreat"
  | "desperate-escape"
  | "ongoing"
  | "engaging"
  | "objective"
  | "rapid"
  | "tactical"
  | "combat"
  | "emergency"
  | "assault";
/**
 * Something a distance is measured to: a unit, an objective marker, a named marker, a battlefield edge or the centre of the battlefield.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "place-ref".
 */
export type PlaceRef =
  | UnitRef
  | {
      objective: ObjectiveFilter;
    }
  | {
      marker: string;
    }
  | ("battlefield-edge" | "battlefield-centre");
/**
 * Army gate: every model in the army must carry at least one of these keywords for the rule to apply (e.g. ['Chaos Knights', 'Heretic Astartes'] for Daemonic Pact). Empty = no army-level gate (the rule is then gated only by `detachment_ids`, whose detachments are themselves faction-locked).
 */
export type KeywordList1 = Keyword[];
/**
 * A unit qualifies for this pool when it carries any of these keywords (e.g. ['Legiones Daemonica'], ['Damned'], ['Vanguard Invader']). Empty = the whole `source_faction_id` is the pool.
 */
export type KeywordList2 = Keyword[];
/**
 * Additional filter: a unit must carry ALL of these to be included via this rule (e.g. the matching god ['Khorne'] for a per-god Daemon pool).
 */
export type KeywordList3 = Keyword[];
/**
 * A unit carrying ANY of these cannot be included via this rule (e.g. Brood Brothers bans 'Aircraft', 'Epic Hero', 'Ogryn', ...).
 */
export type KeywordList4 = Keyword[];
/**
 * Per-keyword Battleline ratio constraint: for each keyword listed, the number of non-BATTLELINE units with that keyword included via this rule cannot exceed the number of BATTLELINE units with that keyword included via this rule (e.g. Daemonic Pact's per-god ['Khorne','Tzeentch','Nurgle','Slaanesh']).
 */
export type KeywordList5 = Keyword[];
/**
 * A zone footprint, expressed as an axis-aligned rectangle or an explicit polygon. Vertices/extent are relative to the owning element's position.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "zone-shape".
 */
export type ZoneShape =
  | {
      type: "rectangle";
      width: number;
      height: number;
    }
  | {
      type: "polygon";
      /**
       * @minItems 3
       */
      points: [Vec2, Vec2, Vec2, ...Vec2[]];
    };
/**
 * Which player a zone or territory belongs to.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "side".
 */
export type Side = "attacker" | "defender";
/**
 * Game modes this detachment is legal or authored for; absent implies matched-play.
 *
 * @minItems 1
 */
export type GameModes1 = [GameModeId, ...GameModeId[]];
/**
 * Game modes this enhancement is legal or authored for; absent implies matched-play.
 *
 * @minItems 1
 */
export type GameModes2 = [GameModeId, ...GameModeId[]];
/**
 * Eligibility predicate for which units may perform the action.
 */
export type AbilityDSLCondition = SimpleCondition | CompoundCondition;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "simple-condition".
 */
export type SimpleCondition =
  | PhaseIsCondition
  | PlayerTurnIsCondition
  | BattleRoundCondition
  | RuleActiveCondition
  | HasKeywordCondition
  | OwnedByCondition
  | HasAbilityCondition
  | SameUnitCondition
  | AttachmentCondition
  | StrengthCondition
  | ModelCountCondition
  | ModelProfileCondition
  | WoundsCondition
  | LoadoutCondition
  | UnitStateCondition
  | EligibleCondition
  | HappenedCondition
  | HappenedCompareCondition
  | WithinCondition
  | InRegionCondition
  | ClosestCondition
  | ControlsCondition
  | AttackIsCondition
  | AttackCompareCondition
  | RollResultCondition
  | VisibleCondition
  | DesignatedCondition
  | ResourceCondition
  | OperationMarkersCondition
  | EngagementFrontsCondition
  | DestroyedWhileOnObjectiveCondition
  | DestroyedInTaggedTerrainCondition
  | BattleSizeCondition
  | ArmyFactionCondition
  | MovedOverCondition
  | GuidedCondition;
/**
 * What the event was aimed at: a unit, or (for actions) an objective or terrain area.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "event-target".
 */
export type EventTarget =
  | UnitRef
  | {
      objective: ObjectiveFilter;
    }
  | {
      terrain_area: {
        territory?: "your-territory" | "enemy-territory" | "no-mans-land";
      };
    };
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "compound-condition".
 */
export type CompoundCondition =
  | {
      operator: "and" | "or";
      /**
       * @minItems 1
       */
      operands: [ConditionNode, ...ConditionNode[]];
    }
  | {
      operator: "not";
      /**
       * @minItems 1
       * @maxItems 1
       */
      operands: [ConditionNode];
    };
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "condition-node".
 */
export type ConditionNode = SimpleCondition | CompoundCondition;
/**
 * Predicate for when the action is considered complete.
 */
export type AbilityDSLCondition1 = SimpleCondition | CompoundCondition;
/**
 * Effect applied when the action completes (e.g. terrain-area-tag, objective-tag, or unit-tag to mark transient state).
 */
export type AbilityEffect =
  | SingleEffect
  | StanceSelectEffect
  | StanceSelectionCapacityEffect
  | ChoiceEffect
  | SequenceEffect
  | RulesBundleEffect
  | AbilityPart
  | DiceGatedEffect
  | DiceTableEffect
  | ConditionalEffect
  | DicePoolAllocationEffect
  | SelectUnitsEffect
  | ForEachUnitEffect
  | AuraEffect
  | DesignateTargetEffect
  | RiskRewardEffect
  | IssueOrdersEffect
  | ResourceActionMenuEffect
  | NamedRegionStateEffect
  | LeaderModelAbilityGrantEffect
  | PersistentDesignationEffect
  | NoEffectEffect
  | RollEffect
  | SelectObjectiveEffect;
/**
 * One effect: a type, the unit-ref it applies to (`target`), and that effect's closed `modifier`.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "single-effect".
 */
export type SingleEffect =
  | StatModifierEffect
  | IgnoreModifiersEffect
  | RollModifierEffect
  | ReRollEffect
  | RollResultEffect
  | EndAttackSequenceEffect
  | AbilityGrantEffect
  | KeywordGrantEffect
  | WeaponAbilityGrantEffect
  | WeaponGrantEffect
  | AbilityModifierEffect
  | AbilityActivateEffect
  | PermissionEffect
  | TargetingEffect
  | CountsAsEffect
  | RuleStateEffect
  | MortalWoundsEffect
  | DamageReductionEffect
  | FeelNoPainEffect
  | InvulnerableSaveEffect
  | HealEffect
  | ReturnModelsEffect
  | DestroyModelsEffect
  | ActOnDeathEffect
  | SplitUnitEffect
  | AddUnitEffect
  | DestructionRuleEffect
  | MoveEffect
  | MoveModifierEffect
  | SetUpEffect
  | MarkerEffect
  | TransportCapacityEffect
  | TestEffect
  | StateChangeEffect
  | CpGainEffect
  | CostModifierEffect
  | ResourceGainEffect
  | ResourceSpendEffect
  | ResourceDieEffect
  | ObjectiveStickyEffect
  | DesignateEffect
  | ArmyRuleEffect
  | TestExemptionEffect
  | DatasheetSwapEffect
  | CharacteristicResolutionEffect
  | BorrowWeaponsEffect
  | SelectWeaponEffect;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "effect-node".
 */
export type EffectNode =
  | SingleEffect
  | StanceSelectEffect
  | StanceSelectionCapacityEffect
  | ChoiceEffect
  | SequenceEffect
  | RulesBundleEffect
  | AbilityPart
  | DiceGatedEffect
  | DiceTableEffect
  | ConditionalEffect
  | DicePoolAllocationEffect
  | SelectUnitsEffect
  | ForEachUnitEffect
  | AuraEffect
  | DesignateTargetEffect
  | RiskRewardEffect
  | IssueOrdersEffect
  | ResourceActionMenuEffect
  | NamedRegionStateEffect
  | LeaderModelAbilityGrantEffect
  | PersistentDesignationEffect
  | NoEffectEffect
  | RollEffect
  | SelectObjectiveEffect;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "dice-gated-effect".
 */
export type DiceGatedEffect = {
  [k: string]: unknown;
} & {
  type: "dice-gated";
  /**
   * Dice expression, e.g. 'D6', '2D6'
   */
  dice?: string;
  /**
   * Fixed threshold or model characteristic to compare against
   */
  threshold?: number | ("leadership" | "toughness" | "save");
  comparison?: "gte" | "lte" | "gt" | "lt" | "eq";
  on_success?: EffectNode | null;
  on_fail?: EffectNode | null;
  /**
   * Marks this gate as the RIDER half of a roll-with-rider composition: a `sequence` whose first step is this gate and whose second step is the unconditional primary. The gate's effect fires on the roll and the primary resolves regardless, so the sequence renders with a mandatory "Regardless of the result" clause. Structurally identical to a real gate (a `dice-gated` with `on_success` and no `on_fail`), which is why the distinction is declared rather than inferred.
   */
  rider?: boolean;
  /**
   * Perform the named actual 2D6 test using the subject's current Leadership and normal applicable modifiers and reroll permissions. A Battle-shock failure inflicts Battle-shock as well as resolving on_fail; a Leadership test does not.
   */
  test?: {
    kind: "leadership" | "battle-shock";
    subject: "unit" | "self" | "target";
    /**
     * @minItems 1
     */
    modifiers?: [
      {
        condition: AbilityDSLCondition2;
        value: number;
      },
      ...{
        condition: AbilityDSLCondition2;
        value: number;
      }[]
    ];
  };
  from?: RollReference1;
  /**
   * With `from`: succeeds when the bound roll's unused dice form this pair, triple or run; those dice are then used up.
   */
  requirement?:
    | DiceRequirement
    | {
        /**
         * @minItems 2
         */
        any_of: [DiceRequirement, DiceRequirement, ...DiceRequirement[]];
      };
  /**
   * Which roll this is (a Psychic test), so modifiers and re-rolls to that roll apply.
   */
  kind?:
    | (
        | "hit"
        | "wound"
        | "save"
        | "damage"
        | "charge"
        | "advance"
        | "battle-shock"
        | "leadership"
        | "hazard"
        | "psychic"
        | "desperate-escape"
        | "dark-pact"
        | "blessings-of-khorne"
        | "manoeuvre"
        | "channelling"
      )
    | AbilityRoll;
};
/**
 * A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
 */
export type AbilityDSLCondition2 = SimpleCondition | CompoundCondition;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "dice-requirement-spec".
 */
export type DiceRequirementSpec =
  | DiceRequirement
  | {
      /**
       * @minItems 2
       */
      any_of: [DiceRequirement, DiceRequirement, ...DiceRequirement[]];
    };
/**
 * A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
 */
export type AbilityDSLCondition3 = SimpleCondition | CompoundCondition;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "event-or-selection-reference".
 */
export type EventOrSelectionReference = EventBoundReference | SelectionReference;
/**
 * How long an effect, a part or a designation lasts; the one expiry vocabulary for scope.duration, ability-part.duration, designate.clears_on and the designation containers. attack-sequence expires when the currently selected unit finishes resolving its shooting or fighting attacks; resolution lasts only while resolving this activation and is not a battle/phase usage limit; until-this-unit-has-shot ends once the unit with the ability has resolved its ranged attacks; control-lost ends when you stop controlling the designated objective. one-use is retired (use usage n-per-battle) and leaves the enum once no record carries it.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "scope-duration".
 */
export type ScopeDuration =
  | "phase"
  | "turn"
  | "battle-round"
  | "battle"
  | "until-next-command-phase"
  | "until-next-movement-phase"
  | "until-next-battle-round"
  | "until-start-next-turn"
  | "one-use"
  | "permanent"
  | "attack-sequence"
  | "resolution"
  | "until-next-shooting-phase"
  | "until-end-of-your-next-turn"
  | "until-end-of-opponent-next-turn"
  | "until-this-unit-has-shot"
  | "control-lost";
/**
 * A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
 */
export type AbilityDSLCondition4 = SimpleCondition | CompoundCondition;
/**
 * A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
 */
export type AbilityDSLCondition5 = SimpleCondition | CompoundCondition;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "transport-occupancy-subject-kind".
 */
export type TransportOccupancySubjectKind = "unit-models" | "single-model";
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "transport-eligibility".
 */
export type TransportEligibility = {
  requires_capacity_keyword?: string;
  embark_as_keyword?: string;
} & TransportEligibility1;
export type TransportEligibility1 = {
  [k: string]: unknown;
};
/**
 * A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
 */
export type AbilityDSLCondition6 = SimpleCondition | CompoundCondition;
/**
 * AND set: the target must carry every keyword listed here.
 */
export type KeywordList6 = Keyword[];
/**
 * OR set: the target must carry at least one keyword listed here. Use for rules that target a unit with one of several keywords (e.g. Crushing Impact's MONSTER/VEHICLE, Explosives' EXPLOSIVES/GRENADES). Mirrors the `army_keywords_any` OR-gate on allied-rule.schema.json.
 */
export type KeywordList7 = Keyword[];
/**
 * A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
 */
export type AbilityDSLCondition7 = SimpleCondition | CompoundCondition;
/**
 * Game modes this stratagem is legal or authored for; absent implies matched-play.
 *
 * @minItems 1
 */
export type GameModes3 = [GameModeId, ...GameModeId[]];
/**
 * Game modes this unit composition is legal or authored for; absent implies matched-play.
 *
 * @minItems 1
 */
export type GameModes4 = [GameModeId, ...GameModeId[]];
export type AbilityEffect1 =
  | SingleEffect
  | StanceSelectEffect
  | StanceSelectionCapacityEffect
  | ChoiceEffect
  | SequenceEffect
  | RulesBundleEffect
  | AbilityPart
  | DiceGatedEffect
  | DiceTableEffect
  | ConditionalEffect
  | DicePoolAllocationEffect
  | SelectUnitsEffect
  | ForEachUnitEffect
  | AuraEffect
  | DesignateTargetEffect
  | RiskRewardEffect
  | IssueOrdersEffect
  | ResourceActionMenuEffect
  | NamedRegionStateEffect
  | LeaderModelAbilityGrantEffect
  | PersistentDesignationEffect
  | NoEffectEffect
  | RollEffect
  | SelectObjectiveEffect;
export type UnitAbilityRef = {
  [k: string]: unknown;
};
/**
 * Game modes this unit is legal or authored for; absent implies matched-play.
 *
 * @minItems 1
 */
export type GameModes5 = [GameModeId, ...GameModeId[]];
/**
 * Game modes this wargear option is legal or authored for; absent implies matched-play.
 *
 * @minItems 1
 */
export type GameModes6 = [GameModeId, ...GameModeId[]];
/**
 * The keyword applies only when the target has at least one listed keyword.
 *
 * @minItems 1
 */
export type KeywordList8 = [Keyword, ...Keyword[]];
/**
 * The keyword does not apply when the target has any listed keyword.
 */
export type KeywordList9 = Keyword[];
/**
 * The profile can target a unit carrying at least one listed keyword.
 *
 * @minItems 1
 */
export type KeywordList10 = [Keyword, ...Keyword[]];
/**
 * The profile cannot target a unit carrying any listed keyword.
 */
export type KeywordList11 = Keyword[];
/**
 * Game modes this weapon is legal or authored for; absent implies matched-play.
 *
 * @minItems 1
 */
export type GameModes7 = [GameModeId, ...GameModeId[]];
/**
 * For reactive abilities: the game event(s) this ability fires on, plus structured guards. One trigger object, OR an array of trigger objects — the ability fires on ANY listed trigger (models multi-event reactions like 'set up OR ends a move'). See `$defs/trigger`.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "ability-trigger".
 */
export type AbilityTrigger = Trigger | [Trigger, ...Trigger[]];
/**
 * How often the ability may be used: one limit, or several that all apply (once per battle per model AND one model per battle round).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "ability-usage".
 */
export type AbilityUsage = AbilityUsageLimit | [AbilityUsageLimit, AbilityUsageLimit, ...AbilityUsageLimit[]];
/**
 * A predicate, or and/or/not over predicates. Every predicate sits on one axis (clock, army, identity, composition, state, history, position, board, attack, visibility, designation, resource) and names the unit it tests with `subject` (a unit-ref, default this-unit). Negation is only the `not` operator.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "condition".
 */
export type AbilityDSLCondition8 = SimpleCondition | CompoundCondition;
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "rule-state-core-rule-slug".
 */
export type RuleStateCoreRuleSlug =
  | "benefit-of-cover"
  | "fall-back"
  | "ordered-retreat"
  | "advance"
  | "charge"
  | "fire-overwatch"
  | "overwatch-against-bearer"
  | "desperate-escape"
  | "attacking-ends-hidden"
  | "take-to-the-skies"
  | "engaged-shooting-hit-penalty"
  | "charge-bonus"
  | "hidden"
  | "orders-end-on-battle-shock";
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "paired-unit-selector".
 */
export type PairedUnitSelector = {
  [k: string]: unknown;
};
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "effect".
 */
export type AbilityEffect2 =
  | SingleEffect
  | StanceSelectEffect
  | StanceSelectionCapacityEffect
  | ChoiceEffect
  | SequenceEffect
  | RulesBundleEffect
  | AbilityPart
  | DiceGatedEffect
  | DiceTableEffect
  | ConditionalEffect
  | DicePoolAllocationEffect
  | SelectUnitsEffect
  | ForEachUnitEffect
  | AuraEffect
  | DesignateTargetEffect
  | RiskRewardEffect
  | IssueOrdersEffect
  | ResourceActionMenuEffect
  | NamedRegionStateEffect
  | LeaderModelAbilityGrantEffect
  | PersistentDesignationEffect
  | NoEffectEffect
  | RollEffect
  | SelectObjectiveEffect;

/**
 * Auto-generated by tools/src/bundle-schemas.ts. Single self-contained schema for Rust codegen — do not edit by hand.
 */
export interface KdcBundledSchemas {
  [k: string]: unknown;
}
/**
 * A stable identifier assigned to the same entity by an external data source.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "external-reference".
 */
export interface ExternalReference {
  /**
   * Open source namespace, such as 'mfm', 'bsdata', or 'game-datacards'.
   */
  namespace: string;
  /**
   * Identifier exactly as assigned by the external source.
   */
  id: string;
}
/**
 * A 2D point in board inches. Origin at a board corner; JSON uses y-down (downstream renderers may flip to y-up).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "vec2".
 */
export interface Vec2 {
  x: number;
  y: number;
}
/**
 * A wall polyline: an open path of 2+ vertices with optional thickness, in the same local frame as the footprint.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "wall".
 */
export interface Wall {
  /**
   * @minItems 2
   */
  points: [Vec2, Vec2, ...Vec2[]];
  /**
   * Wall thickness in inches. Omit for thin walls.
   */
  thickness?: number;
}
/**
 * A model's base. 'round' carries 'diameter'; 'oval' carries 'width'+'length'. 'flying-base' (with 'size': small/large), 'hull', and 'unique' are categories the GW base-size guide gives without standard millimetre dimensions; entries carrying such a category, or any millimetre value not taken from an authoritative source, set 'draft': true to mark them for later hand-authoring.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "base-size".
 */
export interface BaseSize {
  shape: "round" | "oval" | "flying-base" | "hull" | "unique";
  diameter?: number;
  width?: number;
  length?: number;
  /**
   * Flying-base size class, when 'shape' is 'flying-base'.
   */
  size?: "small" | "large";
  /**
   * True when the entry is provisional/guessed (e.g. a category without authoritative dimensions) and should be revisited.
   */
  draft?: boolean;
}
/**
 * Any unit (or model, with level: model) matching every listed property. Reads as 'a unit that…'.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "unit-filter".
 */
export interface UnitFilter {
  owner?: Owner;
  all_of?: KeywordList;
  any_of?: KeywordList;
  none_of?: KeywordList;
  /**
   * The unit carries this designation (a tag an effect applied).
   */
  designated?: string;
  state?: UnitState;
  /**
   * model: the filter matches individual models. Default unit.
   */
  level?: "unit" | "model";
  /**
   * Only units visible to the subject of the enclosing predicate.
   */
  visible?: true;
  /**
   * Only units within (wholly within, if set) this range of `of` (default the unit with the ability): aura recipients.
   */
  within?: {
    range: RangeRef;
    of?: UnitRef;
    wholly?: true;
  };
  /**
   * Not this unit ("another friendly unit").
   */
  excluding?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The designation was applied by this unit (their Spotted unit). Requires `designated`.
   */
  designated_by?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The unit does not carry this designation.
   */
  not_designated?: string;
  /**
   * Units embarked within this Transport.
   */
  embarked_in?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * Models (level: model) or units that are part of this unit, attached units included.
   */
  member_of?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  engaged_with?: UnitFilter1;
  not_engaged_with?: UnitFilter2;
  /**
   * Units with every listed ability.
   *
   * @minItems 1
   */
  has_ability?: [EntityId, ...EntityId[]];
  /**
   * Units with none of the listed abilities.
   *
   * @minItems 1
   */
  lacks_ability?: [EntityId, ...EntityId[]];
}
/**
 * Units within Engagement Range of at least one unit matching this filter.
 */
export interface UnitFilter1 {
  owner?: Owner;
  all_of?: KeywordList;
  any_of?: KeywordList;
  none_of?: KeywordList;
  /**
   * The unit carries this designation (a tag an effect applied).
   */
  designated?: string;
  state?: UnitState;
  /**
   * model: the filter matches individual models. Default unit.
   */
  level?: "unit" | "model";
  /**
   * Only units visible to the subject of the enclosing predicate.
   */
  visible?: true;
  /**
   * Only units within (wholly within, if set) this range of `of` (default the unit with the ability): aura recipients.
   */
  within?: {
    range: RangeRef;
    of?: UnitRef;
    wholly?: true;
  };
  /**
   * Not this unit ("another friendly unit").
   */
  excluding?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The designation was applied by this unit (their Spotted unit). Requires `designated`.
   */
  designated_by?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The unit does not carry this designation.
   */
  not_designated?: string;
  /**
   * Units embarked within this Transport.
   */
  embarked_in?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * Models (level: model) or units that are part of this unit, attached units included.
   */
  member_of?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  engaged_with?: UnitFilter1;
  not_engaged_with?: UnitFilter2;
  /**
   * Units with every listed ability.
   *
   * @minItems 1
   */
  has_ability?: [EntityId, ...EntityId[]];
  /**
   * Units with none of the listed abilities.
   *
   * @minItems 1
   */
  lacks_ability?: [EntityId, ...EntityId[]];
}
/**
 * Units within Engagement Range of no unit matching this filter.
 */
export interface UnitFilter2 {
  owner?: Owner;
  all_of?: KeywordList;
  any_of?: KeywordList;
  none_of?: KeywordList;
  /**
   * The unit carries this designation (a tag an effect applied).
   */
  designated?: string;
  state?: UnitState;
  /**
   * model: the filter matches individual models. Default unit.
   */
  level?: "unit" | "model";
  /**
   * Only units visible to the subject of the enclosing predicate.
   */
  visible?: true;
  /**
   * Only units within (wholly within, if set) this range of `of` (default the unit with the ability): aura recipients.
   */
  within?: {
    range: RangeRef;
    of?: UnitRef;
    wholly?: true;
  };
  /**
   * Not this unit ("another friendly unit").
   */
  excluding?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The designation was applied by this unit (their Spotted unit). Requires `designated`.
   */
  designated_by?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The unit does not carry this designation.
   */
  not_designated?: string;
  /**
   * Units embarked within this Transport.
   */
  embarked_in?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * Models (level: model) or units that are part of this unit, attached units included.
   */
  member_of?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  engaged_with?: UnitFilter1;
  not_engaged_with?: UnitFilter2;
  /**
   * Units with every listed ability.
   *
   * @minItems 1
   */
  has_ability?: [EntityId, ...EntityId[]];
  /**
   * Units with none of the listed abilities.
   *
   * @minItems 1
   */
  lacks_ability?: [EntityId, ...EntityId[]];
}
/**
 * Which objectives. Every listed property must hold.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "objective-filter".
 */
export interface ObjectiveFilter {
  role?: "central" | "expansion" | "home" | "non-home";
  /**
   * The friendly or the enemy home objective.
   */
  home_of?: "friendly" | "enemy";
  territory?: "your-territory" | "enemy-territory" | "no-mans-land";
  controlled_by?: Owner;
  designated?: DesignationId;
  /**
   * Kebab-case identifier
   */
  name?: string;
  /**
   * The objective marker a select-objective step bound.
   */
  selection_var?: string;
}
/**
 * Narrows an event family: which selection, move, roll or rule. Only the properties that make sense for the family are used.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "event-filter".
 */
export interface EventFilter {
  /**
   * selected: what the unit was selected to do. attack means shoot or fight.
   */
  to?: "move" | "shoot" | "fight" | "attack" | "disembark" | "observe" | "declare-charge";
  /**
   * targets-selected / attacks-resolved / used: which kind of targeting, attack or rule.
   */
  kind?:
    | "attack"
    | "shoot"
    | "fight"
    | "charge"
    | "stratagem"
    | "ability"
    | "action"
    | "manoeuvre"
    | "order"
    | "ritual"
    | "dark-pact"
    | "act-of-faith"
    | "doctrine"
    | "contract";
  /**
   * Kebab-case identifier
   */
  id?: string;
  /**
   * @minItems 1
   */
  move_types?: [
    (
      | "normal"
      | "advance"
      | "remain-stationary"
      | "fall-back"
      | "charge"
      | "pile-in"
      | "consolidation"
      | "ingress"
      | "surge"
      | "scout"
      | "disembark"
    ),
    ...(
      | "normal"
      | "advance"
      | "remain-stationary"
      | "fall-back"
      | "charge"
      | "pile-in"
      | "consolidation"
      | "ingress"
      | "surge"
      | "scout"
      | "disembark"
    )[]
  ];
  /**
   * A move type's named mode (a Fall Back's desperate escape, a combat disembark).
   */
  mode?:
    | "ordered-retreat"
    | "desperate-escape"
    | "ongoing"
    | "engaging"
    | "objective"
    | "rapid"
    | "tactical"
    | "combat"
    | "emergency"
    | "assault";
  roll?: RollKind;
  result?: RollOutcome;
  from?: "strategic-reserves" | "deep-strike" | "cult-ambush" | "transport";
  through?: "terrain" | "tall-terrain";
  attack_type?: "ranged" | "melee" | "psychic" | "mortal";
  weapon_name?: string;
  weapon_keyword?: string;
  /**
   * Who caused it (the unit or model whose attack destroyed the object).
   */
  by?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * destroyed: resolve before the model is removed.
   */
  timing?: "before-removal";
  /**
   * Only the first time this happens in the window.
   */
  first?: true;
  step?: "battle-shock" | "reinforcements";
  state?: UnitState;
  tag?: DesignationId;
  pool?: string;
  marker?: string;
  /**
   * used: any ability whose name carries this keyword in brackets (BONDSMAN for every '(Bondsman)' ability), instead of one `id`.
   */
  ability_keyword?: string;
  /**
   * used: the same ability or Stratagem the event a trigger bound (binds_event_variable) used.
   */
  same_rule_as?: {
    event_var: string;
  };
}
/**
 * The dice a named ability rolls (Reanimation Protocols' roll), not every roll the unit makes.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "ability-roll".
 */
export interface AbilityRoll {
  of_ability: EntityId;
}
/**
 * One value per battle size (Incursion, Strike Force, Onslaught). Accepted wherever a count, amount or cap is: the value that applies is the one for the battle being played.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "battle-size-value".
 */
export interface BattleSizeValue {
  incursion: number;
  "strike-force": number;
  onslaught: number;
}
/**
 * The result of a roll an enclosing `roll` step bound: its total, or (with successes_on) how many of its dice rolled that value or higher.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "roll-reference".
 */
export interface RollReference {
  roll_var: string;
  successes_on?: number;
}
/**
 * A number equal to how many of `count_of` there are (models in this unit with `keyword`, models equipped with `wargear`, the battle round number).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "count-of".
 */
export interface CountOf {
  count_of: ScalingSource;
  keyword?: Keyword;
  wargear?: EntityId;
  within_inches?: number;
}
/**
 * The rating the unit's datasheet prints for this rule (the D3 of Deadly Demise D3, the 5 of Feel No Pain 5+): the value of the unit's ability_ids entry for the ability that carries this effect.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "unit-rating".
 */
export interface UnitRating {
  rating: true;
}
/**
 * Set up within `range` of `of` (wholly within, if set).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "placement-near".
 */
export interface PlacementNear {
  of: PlaceRef;
  range: RangeRef;
  wholly?: true;
}
/**
 * Set up more than `range` away from `of` (enemy models: {owner: enemy}).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "placement-away".
 */
export interface PlacementAway {
  of: PlaceRef;
  range: RangeRef;
}
/**
 * Set up inside a region (wholly inside, if set).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "placement-region".
 */
export interface PlacementRegion {
  region: RegionRef;
  wholly?: true;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "game-version-ref".
 */
export interface GameVersionReference {
  edition: Edition;
  dataslate: DataslateVersion;
  [k: string]: unknown;
}
/**
 * The combined points cap for units included via an allied rule at one battle size.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "allied-points-limit".
 */
export interface AlliedPointsLimit {
  /**
   * Battle size this cap applies at. Includes 'onslaught' (3000 pts), which ally rules reference even though the core roster battle-size enum lists only incursion/strike-force.
   */
  battle_size: "incursion" | "strike-force" | "onslaught";
  /**
   * Maximum combined points of units included via the rule at this battle size.
   */
  max_points: number;
}
/**
 * Per-keyword cap on how many units carrying `keyword` may be included via an allied rule at one battle size.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "allied-keyword-limit".
 */
export interface AlliedKeywordLimit {
  /**
   * Keyword the cap counts (matched case-insensitively against a unit's keywords union faction_keywords, e.g. 'Titanic', 'Armiger', 'Character').
   */
  keyword: string;
  /**
   * Battle size this cap applies at.
   */
  battle_size: "incursion" | "strike-force" | "onslaught";
  /**
   * Maximum number of units carrying `keyword` includable via the rule at this battle size.
   */
  max_count: number;
}
/**
 * A community-authored model of an allied-detachment / 'soup' rule: the named exception by which units lacking the army's chosen Faction keyword may still be included (e.g. Daemonic Pact, Brood Brothers, Iconoclast Fiefdom's Damned access). One rule = one allied source pool; a faction that allies in several pools (the Chaos cult pattern: a Chaos Knights pool plus a matching-god Daemons pool) carries one rule per pool. The rule is gated by two optional, AND-combined conditions: an army-wide keyword condition (`army_keywords_any`) and/or a selected detachment (`detachment_ids`).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "allied-rule".
 */
export interface AlliedRule {
  id: EntityId;
  name: string;
  /**
   * Short panel/category heading a list builder groups this pool under (e.g. 'Daemons', 'Imperial Agents', 'Titanic Allies'). Defaults to `name` when omitted.
   */
  label?: string;
  army_keywords_any?: KeywordList1;
  /**
   * Detachment gate: the rule applies only when at least one listed detachment is selected. Empty/absent = no detachment gate. Replaces the former single detachment_id (GW pools may gate on several detachments).
   */
  detachment_ids?: EntityId[];
  /**
   * Faction the ally pool is drawn from, when scoping by faction is needed to disambiguate units whose id is shared across factions. Optional hint; `source_keywords` is the primary filter.
   */
  source_faction_id?: EntityId | null;
  source_keywords?: KeywordList2;
  /**
   * Explicit datasheet allowlist: when non-empty, a unit qualifies only if its id is listed (AND-combined with source_keywords/required_keywords/excluded_keywords/roles). GW soup pools enumerate by datasheet; this is the primary unit selector for generated rules. Empty/absent = no datasheet-level restriction.
   */
  source_datasheet_ids?: EntityId[];
  required_keywords?: KeywordList3;
  excluded_keywords?: KeywordList4;
  /**
   * Optional battlefield-role filter (matched against a unit's `role`). Empty = no role restriction.
   */
  roles?: string[];
  /**
   * Absolute points cap on the combined cost of units included via this rule, per battle size. Empty = no points cap. A rule lists at most one entry per battle size.
   */
  points_limits?: AlliedPointsLimit[];
  /**
   * Per-keyword, per-battle-size cap on how many units carrying `keyword` may be included via this rule (e.g. Imperial Knights' Titanic 1 / Armiger 3; Agents of the Imperium's Character/Retinue/Requisitioned counts). Advisory construction cap.
   */
  keyword_limits?: AlliedKeywordLimit[];
  /**
   * Optional cap on the number of units included via this rule, independent of points. null = no unit-count cap.
   */
  max_units?: number | null;
  /**
   * True when units included via this rule cannot be the army's Warlord (e.g. Daemonic Pact, Star Children's Blessings).
   */
  cannot_be_warlord?: boolean;
  /**
   * True when units included via this rule cannot be given Enhancements (e.g. Daemonic Pact).
   */
  cannot_take_enhancements?: boolean;
  /**
   * Host-Warlord requirement: a model carrying this keyword must be the army's Warlord (e.g. Brood Brothers requires a 'Genestealer Cults' Warlord). null = no such requirement.
   */
  warlord_required_keyword?: Keyword | null;
  /**
   * Datasheet allowlist for which units included via this rule may be the army Warlord (the specific characters GW permits). Non-empty = only these may be Warlord among the pool's units; pair with cannot_be_warlord:false. Empty/absent = no per-datasheet warlord allowlist.
   */
  warlord_datasheet_ids?: EntityId[];
  /**
   * Abilities that included units lose under this rule (e.g. Astra Militarum units lose 'voice-of-command' under Brood Brothers). A display/effect hint, not a construction constraint.
   */
  removes_ability_ids?: EntityId[];
  battleline_ratio_keywords?: KeywordList5;
  game_version: GameVersionReference;
  notes?: string;
}
/**
 * A deployment map: per-side deployment zones, objective positions, and (11e) per-side territory polygons. Pattern geometry carries forward unchanged from 10th edition; downstream tooling (e.g. bevy-deploy-helper) consumes this as the canonical encoding.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "deployment-pattern".
 */
export interface DeploymentPattern {
  id: EntityId;
  name: string;
  /**
   * Mission pack or source the pattern originates from (e.g. 'leviathan').
   */
  source?: string;
  description?: string;
  /**
   * Per-side deployment zones.
   *
   * @minItems 1
   */
  zones: [
    {
      player: Side;
      name?: string;
      shape: ZoneShape;
      position: Vec2;
      /**
       * Hex render color for the zone overlay.
       */
      color?: string;
    },
    ...{
      player: Side;
      name?: string;
      shape: ZoneShape;
      position: Vec2;
      /**
       * Hex render color for the zone overlay.
       */
      color?: string;
    }[]
  ];
  /**
   * 11e per-side territory polygons, mirroring the deployment-zone shape (e.g. the band between a deployment zone and the midline). Empty until authored.
   */
  territories?: {
    player: Side;
    shape: ZoneShape;
    position: Vec2;
  }[];
  /**
   * Objective-marker positions on the board.
   */
  objectives?: Vec2[];
  /**
   * Ids of recommended terrain-layout entities (resolved once terrain-layout data is authored).
   */
  recommended_terrain_layout_ids?: EntityId[];
  game_version: GameVersionReference;
}
/**
 * A construction keyword a detachment grants to units matching a keyword filter. Blanket by default (every matching unit gains it); when `max_selected` is set, the keyword is instead granted to up to that many matching units of the player's choice (e.g. Houndpack Lance: 'select three WAR DOG units; they gain CHARACTER').
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "granted-keyword".
 */
export interface GrantedKeyword {
  keyword: Keyword;
  to_keywords: KeywordList;
  /**
   * When present, the grant is not blanket: the player selects up to this many matching units to receive `keyword` (e.g. 3 WAR DOG units gain CHARACTER under Houndpack Lance). Absent = every matching unit gains it.
   */
  max_selected?: number;
}
/**
 * A minimum number of units carrying a keyword that the detachment requires.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "unit-minimum".
 */
export interface UnitMinimum {
  keyword: Keyword;
  min: number;
}
/**
 * A detachment option within a faction, providing a detachment rule, enhancements, and stratagems.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "detachment".
 */
export interface Detachment {
  id: EntityId;
  external_refs?: ExternalReferenceList;
  name: string;
  faction_id: EntityId;
  /**
   * Deprecated single-rule link, kept for back-compat (and referenced by allied-rule). A detachment may have more than one rule ability — prefer `detachment_rule_ids`.
   */
  detachment_rule_id?: EntityId | null;
  /**
   * ability_ids of every detachment-rule ability this detachment provides (a detachment rule may have multiple named parts). These match the enrichment `abilities.json` / raw-text-store ids, so the downstream lookup `store[ability_id]` resolves. Empty/absent until linked by author:reconcile.
   */
  detachment_rule_ids?: EntityId[];
  /**
   * 11e: the detachment-point cost (1–3) charged against the army's detachment-point budget. null when not yet assigned.
   */
  detachment_points?: number | null;
  /**
   * 11e: ids of the Force Disposition entities this detachment grants. Empty until assigned.
   */
  force_dispositions?: EntityId[];
  /**
   * 11e: detachment-type tags (e.g. 'dynasty', 'kabal'). A roster may include at most one detachment per shared tag — the 'you can only take one of X type of detachment' rule. Empty when the detachment carries no UNIQUE tag.
   */
  tags?: string[];
  enhancement_ids?: EntityId[];
  stratagem_ids?: EntityId[];
  restrictions?: {
    required_keywords?: KeywordList;
    excluded_keywords?: KeywordList;
    notes?: string;
  } | null;
  /**
   * Construction keywords this detachment grants to matching units while it is selected (e.g. Houndpack Lance grants 'Battleline' to 'War Dog' units). A unit carrying any keyword in a grant's `to_keywords` gains that grant's `keyword` for army-construction purposes (datasheet-count caps, battlefield role). Empty/absent when the detachment grants no construction keywords. Distinct from combat keywords, which live in the ability DSL.
   */
  granted_keywords?: GrantedKeyword[];
  /**
   * Minimum unit counts the detachment requires while selected (e.g. Houndpack Lance: 'your army must include three or more WAR DOG units'). Each entry requires at least `min` units carrying `keyword`. Empty/absent when the detachment imposes no minimum.
   */
  unit_minimums?: UnitMinimum[];
  game_version: GameVersionReference;
  game_modes?: GameModes1;
}
/**
 * A purchasable upgrade for a character unit, provided by a detachment.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "enhancement".
 */
export interface Enhancement {
  id: EntityId;
  external_refs?: ExternalReferenceList;
  name: string;
  detachment_id: EntityId;
  cost: number;
  /**
   * True when the cost is carried over provisionally (e.g. seeded from a prior edition during migration) and not yet confirmed against the current dataslate.
   */
  points_provisional?: boolean;
  /**
   * 11e: when true, this enhancement applies to up to `max_targets` non-character units while counting as a single Enhancement choice.
   */
  upgrade_tag?: boolean;
  /**
   * Number of units this enhancement may be applied to. Only meaningful when `upgrade_tag` is true; defaults to 1.
   */
  max_targets?: number;
  keyword_restrictions?: KeywordList;
  /**
   * Alternative bearer eligibility groups. Every keyword in one group is required (AND), while satisfying any group is sufficient (OR). When present, this supersedes the legacy flat `keyword_restrictions` field.
   *
   * @minItems 1
   */
  keyword_restriction_groups?: [[Keyword, ...Keyword[]], ...[Keyword, ...Keyword[]][]];
  exclusion_keywords?: KeywordList | null;
  /**
   * Additional bodyguard units the bearer may attach to because it carries this enhancement.
   *
   * @minItems 1
   */
  attachment_bodyguard_ids?: [EntityId, ...EntityId[]];
  ability_id?: EntityId | null;
  is_unique?: boolean;
  game_version: GameVersionReference;
  game_modes?: GameModes2;
}
/**
 * A playable faction or sub-faction.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "faction".
 */
export interface Faction {
  id: EntityId;
  external_refs?: ExternalReferenceList;
  name: string;
  parent_faction_id?: EntityId | null;
  game_version: GameVersionReference;
  keywords?: KeywordList;
  aliases?: string[];
  /**
   * References to the faction-wide abilities in display order
   *
   * @minItems 1
   */
  faction_rule_ids: [EntityId, ...EntityId[]];
  /**
   * Army-construction constraints evaluated against faction keywords. `faction-keyword-cohesion` limits how many distinct additional faction keywords an army built from this faction may include — the Space Marine Chapters rule, where a second Faction keyword names the unit's Chapter and only one Chapter may be fielded.
   */
  army_construction_rules?: {
    type: "faction-keyword-cohesion";
    base_faction_keyword: Keyword;
    /**
     * Which secondary Faction keyword the constraint counts (e.g. `chapter`).
     */
    additional_keyword_source: string;
    /**
     * Maximum number of distinct additional faction keywords an army may include.
     */
    max_distinct: number;
  }[];
  /**
   * URL to the faction's logo/emblem image.
   */
  logo_url?: string;
}
/**
 * A 11e strategic-intent tag granted by detachments. Players compare dispositions at game start to determine the shared mission; asymmetric primary objectives result.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "force-disposition".
 */
export interface ForceDisposition {
  /**
   * One of the five confirmed launch Force Dispositions.
   */
  id: "take-and-hold" | "disruption" | "purge-the-foe" | "priority-assets" | "reconnaissance";
  name: string;
  /**
   * Community-authored description of the disposition's effect (original prose only — no reproduced rules text).
   */
  text?: string;
  game_version: GameVersionReference;
}
/**
 * A 40k game mode — one axis of army-construction scope, parallel to the game_version edition axis. Army-construction entities carry an optional `game_modes` array of these ids; an absent array means the entity belongs to matched-play only. `is_competitive` marks which modes count toward the dataset's headline competitive-coverage metric.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "game-mode".
 */
export interface GameMode {
  /**
   * The game mode an army-construction entity is legal or authored for, parallel to the game_version edition axis. 'matched-play' is the competitive default: when an entity omits `game_modes`, treat it as matched-play only. 'combat-patrol', 'boarding-actions', and 'crusade' are non-competitive modes; of these only combat-patrol currently has an ingest source and coverage measurement (the others are schema-homed for hand-authoring).
   */
  id: "matched-play" | "combat-patrol" | "boarding-actions" | "crusade";
  name: string;
  /**
   * Community-authored summary of the mode (original prose only — no reproduced rules text).
   */
  description?: string;
  /**
   * Whether this mode counts toward the dataset's headline competitive-coverage metric. Only matched-play is competitive; non-competitive modes are tracked on their own coverage dimension.
   */
  is_competitive: boolean;
  game_version: GameVersionReference;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "game-version".
 */
export interface GameVersion {
  edition: Edition;
  dataslate: DataslateVersion;
  effective_date: string;
  label?: string;
  supersedes?: DataslateVersion | null;
}
/**
 * A model's 2D collision footprint as an explicit polygon, used in place of a circular/oval base for vehicles and other hull-based models. Points are authored in local inches (y-down); a consumer re-centers the polygon on its area centroid before placement, so the local origin does not affect where the model lands — only its shape matters (mirrors the terrain-template footprint convention). A hull shape is faction-agnostic and reusable: one outline (e.g. a Rhino chassis) is authored once and referenced by `hull_shape_id` from every model that shares that hull, across factions. This entity stores geometry only — never an image, image URL, or any source-asset metadata.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "hull-shape".
 */
export interface HullShape {
  id: EntityId;
  name: string;
  /**
   * Polygon vertices in local inches (y-down), in order around the outline. A hull is always a polygon (never a rectangle/right-triangle), so the points are given directly rather than via the shared `footprint` oneOf.
   *
   * @minItems 3
   */
  points: [Vec2, Vec2, Vec2, ...Vec2[]];
  /**
   * Cached axis-aligned bounding-box width in inches (max x − min x). Derived from `points`; recorded so consumers can size/scale without recomputing.
   */
  bounds_width_in: number;
  /**
   * Cached axis-aligned bounding-box height in inches (max y − min y). Derived from `points`.
   */
  bounds_height_in: number;
  game_version: GameVersionReference;
}
/**
 * Defines which character units can attach to which bodyguard units.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "leader-attachment".
 */
export interface LeaderAttachment {
  leader_id: EntityId;
  /**
   * @minItems 1
   */
  eligible_bodyguard_ids: [EntityId, ...EntityId[]];
  /**
   * Optional keyword-based eligibility: any unit whose keyword set (keywords ∪ faction_keywords, case-insensitive) contains ALL of these is also an eligible bodyguard, in addition to eligible_bodyguard_ids. Models rules like an Inquisitor leading any IMPERIUM BATTLELINE INFANTRY unit.
   *
   * @minItems 1
   */
  eligible_bodyguard_keywords?: [string, ...string[]];
  game_version: GameVersionReference;
}
/**
 * One cell of the 11e Force Disposition matrix: given the player's own Force Disposition and their opponent's, the mission that player plays. Mirrors a single row on a physical Force Disposition card. The (disposition, opponent_disposition) pair is the conceptual key; compound uniqueness across entries is a data convention, not enforced by this schema.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "mission-matchup".
 */
export interface MissionMatchup {
  id: EntityId;
  /**
   * The player's own Force Disposition.
   */
  disposition: "take-and-hold" | "disruption" | "purge-the-foe" | "priority-assets" | "reconnaissance";
  /**
   * The opponent's Force Disposition.
   */
  opponent_disposition: "take-and-hold" | "disruption" | "purge-the-foe" | "priority-assets" | "reconnaissance";
  /**
   * Kebab-case identifier
   */
  mission_id: string;
  game_version: GameVersionReference;
}
/**
 * An 11e primary mission (the objective a player scores). Its structured scoring rules live in the same-id primary record in data/core/mission-cards.json and the package's mission-card collection. Which mission a player plays is selected by the Force Disposition matchup matrix (see mission-matchup), keyed on the player's own disposition and their opponent's. Victory points are capped per game and per battle round.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "mission".
 */
export interface Mission {
  id: EntityId;
  name: string;
  /**
   * Mission pack or source the mission originates from.
   */
  source?: string;
  /**
   * Community-authored mission/objective summary (original prose only — no reproduced rules text).
   */
  description?: string;
  /**
   * Maximum primary VP scorable across the whole game. 11e default is 45.
   */
  vp_per_game_cap?: number;
  /**
   * Maximum primary VP scorable in a single battle round. 11e default is 15.
   */
  vp_per_round_cap?: number;
  /**
   * Maximum secondary VP scorable across the whole game. 11e default is 45.
   */
  secondary_vp_per_game_cap?: number;
  /**
   * Maximum secondary VP scorable in a single battle round. 11e default is 15.
   */
  secondary_vp_per_round_cap?: number;
  /**
   * Ids of the deployment-pattern entities (maps) this mission can be played on. Empty until the per-mission maps are confirmed.
   */
  deployment_pattern_ids?: EntityId[];
  game_version: GameVersionReference;
}
/**
 * When a VP award is evaluated. A bare `phase` is the legacy shorthand for 'during this phase'; richer triggers add `timing` (the moment within a phase/turn/game), `player_turn`, and a `battle_round` window. A card's section headers map onto these: 'ANY BATTLE ROUND' omits `battle_round`; 'SECOND BATTLE ROUND ONWARDS' is { min: 2 }; 'END OF THE BATTLE' is timing: end-of-battle.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "scoring-trigger".
 */
export interface ScoringTrigger {
  /**
   * The five official game phases. Unchanged between 10th and 11th edition — 11e reorders Pile In timing within the Fight phase but adds no top-level phase.
   */
  phase?: "command" | "movement" | "shooting" | "charge" | "fight";
  /**
   * The moment the award is checked. 'End of your turn' = end-of-turn; 'End of your Command phase' = end-of-phase with phase: command; 'End of the battle' = end-of-battle.
   */
  timing?: "start-of-turn" | "end-of-turn" | "start-of-phase" | "end-of-phase" | "end-of-battle";
  player_turn?: PlayerTurn;
  /**
   * Battle-round window in which the trigger is active. Absent means any battle round (1-5). 'Second battle round onwards' is { min: 2 }.
   */
  battle_round?: {
    min?: number;
    max?: number;
  };
}
/**
 * A draw-time predicate over an army list (not runtime board state, so deliberately NOT the Ability DSL condition). Used to gate when_drawn operations such as redraws. Example: a card that is void unless the opponent fields a large unit (10e 'Cull the Horde' redrew when the opponent had no unit of 14+ models) is { subject: 'opponent', quantifier: 'none', unit_filter: { model_count_min: 14 } } with operation 'redraw'.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "army-composition-predicate".
 */
export interface ArmyCompositionPredicate {
  /**
   * Whose army list the predicate inspects.
   */
  subject: "self" | "opponent";
  /**
   * Whether the army must contain ('any') or lack ('none') a unit matching unit_filter for the predicate to hold.
   */
  quantifier: "any" | "none";
  /**
   * Criteria a unit in the army must satisfy to match. All present criteria must hold (logical AND).
   */
  unit_filter: {
    model_count_min?: number;
    model_count_max?: number;
    wounds_min?: number;
    keywords?: KeywordList;
  };
}
/**
 * An 11e mission card. The deck-level rule (draw 2 per turn, keep unscored cards) is separate and not modelled here. This is the per-card shape: an optional on-draw deck operation, an optional player action, and zero or more VP-award blocks. Primary mission cards reuse this shape via card_type. Mechanic blocks reference the Ability DSL; prose is community-authored (no reproduced rules text).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "secondary-card".
 */
export interface SecondaryCard {
  id: EntityId;
  name: string;
  /**
   * Whether this is a secondary card or a primary mission card (which reuses this shape).
   */
  card_type?: "secondary" | "primary";
  /**
   * Finer classification within the deck (e.g. a category or tactical/fixed split). Free-form — not enum-locked until 11e categories are confirmed.
   */
  subtype?: string;
  /**
   * Optional deck operation performed when this card is drawn (e.g. redraw, swap). Distinct from combat effects — deck operations have no combat target, so they are not modelled via the Ability DSL effect language. If `condition` is present, the operation fires only when the predicate holds.
   */
  when_drawn?: {
    /**
     * The deck manipulation this card triggers on draw.
     */
    operation: "reshuffle" | "replace" | "redraw" | "draw-extra" | "swap";
    /**
     * Other cards this operation references, by id.
     */
    card_ids?: EntityId[];
    condition?: ArmyCompositionPredicate1;
    /**
     * Battle-round window in which the draw operation is eligible (e.g. { max: 1 } means 'only when drawn in the first battle round'). Absent means the operation fires regardless of round.
     */
    battle_round?: {
      min?: number;
      max?: number;
    };
  };
  /**
   * Optional player actions the card enables. Most cards have a single action; a few (e.g. Observe Enemy, with separate Baited-removal and Spotted actions) have two distinct actions on the same card.
   *
   * @minItems 1
   */
  actions?: [
    {
      /**
       * Optional kebab-case identifier used to reference this action from `action-completed` conditions in `awards[].when`.
       */
      action_id?: string;
      /**
       * The five official game phases. Unchanged between 10th and 11th edition — 11e reorders Pile In timing within the Fight phase but adds no top-level phase.
       */
      starts?: "command" | "movement" | "shooting" | "charge" | "fight";
      /**
       * Non-phase moment the action happens, for card rules that are not started in a phase (Locate and Deny's start-of-battle marker placement, Punishment's start-of-turn condemnation, Consecrate's end-of-turn objective selection). Mutually informative with `starts` — a card action uses one or the other.
       */
      timing?: "start-of-battle" | "start-of-turn" | "end-of-turn";
      /**
       * Battle-round window in which the action can be started. Absent means any battle round. 'From the second battle round onwards' (Triangulate, Extract Intelligence) is { min: 2 }.
       */
      battle_round?: {
        min?: number;
        max?: number;
      };
      player_turn?: PlayerTurn;
      units?: AbilityDSLCondition;
      /**
       * Maximum number of times the action may be performed (per turn unless `use_limit_scope` says otherwise).
       */
      use_limit?: number;
      /**
       * Whether `use_limit` is enforced per turn or once per game (e.g. Recover the Relics / Find and Deny 'Overwhelming Force' is once per game).
       */
      use_limit_scope?: "per-turn" | "per-game";
      completes?: AbilityDSLCondition1;
      effect?: AbilityEffect;
      restrictions?: AbilityDSLCondition6;
    },
    ...{
      /**
       * Optional kebab-case identifier used to reference this action from `action-completed` conditions in `awards[].when`.
       */
      action_id?: string;
      /**
       * The five official game phases. Unchanged between 10th and 11th edition — 11e reorders Pile In timing within the Fight phase but adds no top-level phase.
       */
      starts?: "command" | "movement" | "shooting" | "charge" | "fight";
      /**
       * Non-phase moment the action happens, for card rules that are not started in a phase (Locate and Deny's start-of-battle marker placement, Punishment's start-of-turn condemnation, Consecrate's end-of-turn objective selection). Mutually informative with `starts` — a card action uses one or the other.
       */
      timing?: "start-of-battle" | "start-of-turn" | "end-of-turn";
      /**
       * Battle-round window in which the action can be started. Absent means any battle round. 'From the second battle round onwards' (Triangulate, Extract Intelligence) is { min: 2 }.
       */
      battle_round?: {
        min?: number;
        max?: number;
      };
      player_turn?: PlayerTurn;
      units?: AbilityDSLCondition;
      /**
       * Maximum number of times the action may be performed (per turn unless `use_limit_scope` says otherwise).
       */
      use_limit?: number;
      /**
       * Whether `use_limit` is enforced per turn or once per game (e.g. Recover the Relics / Find and Deny 'Overwhelming Force' is once per game).
       */
      use_limit_scope?: "per-turn" | "per-game";
      completes?: AbilityDSLCondition1;
      effect?: AbilityEffect;
      restrictions?: AbilityDSLCondition6;
    }[]
  ];
  /**
   * VP-award blocks: each scores when `trigger` fires and the optional `when` condition holds. An award scores either a flat `vp` or a count-scaled `vp_per` (VP per instance of the thing named by `per`). Awards accrue independently and sum; a card's '+ ... CUMULATIVE' rows are modelled as separate awards flagged `cumulative` for faithful round-trip. Awards sharing the same `exclusive_group` value within a card resolve as the highest-scoring single award fires (the card's literal 'OR' rows between tier breakpoints, e.g. Record-Breaking Mission's 3-Fronts vs 4-Fronts).
   *
   * @minItems 1
   */
  awards?: [
    (
      | {
          [k: string]: unknown;
        }
      | {
          [k: string]: unknown;
        }
    ),
    ...(
      | {
          [k: string]: unknown;
        }
      | {
          [k: string]: unknown;
        }
    )[]
  ];
  /**
   * Community-authored card description (original prose only — no reproduced rules text).
   */
  text?: string;
  game_version: GameVersionReference;
}
/**
 * Draw-time army-composition predicate gating the operation (e.g. redraw when the opponent lacks a qualifying unit).
 */
export interface ArmyCompositionPredicate1 {
  /**
   * Whose army list the predicate inspects.
   */
  subject: "self" | "opponent";
  /**
   * Whether the army must contain ('any') or lack ('none') a unit matching unit_filter for the predicate to hold.
   */
  quantifier: "any" | "none";
  /**
   * Criteria a unit in the army must satisfy to match. All present criteria must hold (logical AND).
   */
  unit_filter: {
    model_count_min?: number;
    model_count_max?: number;
    wounds_min?: number;
    keywords?: KeywordList;
  };
}
/**
 * [clock] It is this phase.
 */
export interface PhaseIsCondition {
  type: "phase-is";
  parameters: {
    phase: Phase;
  };
}
/**
 * [clock] It is this player's turn.
 */
export interface PlayerTurnIsCondition {
  type: "player-turn-is";
  parameters: {
    turn: "your-turn" | "opponent-turn";
  };
}
/**
 * [clock] The battle round is within [min, max].
 */
export interface BattleRoundCondition {
  type: "battle-round";
  parameters: {
    min?: number;
    max?: number;
  };
}
/**
 * [army] This army or detachment rule is active now (a doctrine, Waaagh!, a pact).
 */
export interface RuleActiveCondition {
  type: "rule-active";
  parameters: {
    rule: EntityId;
  };
}
/**
 * [identity] The subject carries every keyword in all_of and at least one in any_of (or the keyword `chosen_by` an ability had the player pick). Designations (RILED UP, SPOTTED) are `designated`, not keywords.
 */
export interface HasKeywordCondition {
  type: "has-keyword";
  parameters: {
    [k: string]: unknown;
  };
}
/**
 * [identity] The subject belongs to this player.
 */
export interface OwnedByCondition {
  type: "owned-by";
  parameters: {
    subject?: UnitRef;
    owner: "friendly" | "enemy";
  };
}
/**
 * [identity] The subject has this ability (Deep Strike, Oath of Moment, a Discipline).
 */
export interface HasAbilityCondition {
  type: "has-ability";
  parameters: {
    subject?: UnitRef;
    ability: EntityId;
  };
}
/**
 * [identity] The subject is the same unit as `as` (not(same-unit) is 'another unit').
 */
export interface SameUnitCondition {
  type: "same-unit";
  parameters: {
    subject?: UnitRef;
    as: UnitRef;
  };
}
/**
 * [composition] leading: the subject model is leading a unit (matching `with`, if given). led: the subject unit is led by a Leader matching `with`. attached: the subject is part of an attached unit.
 */
export interface AttachmentCondition {
  type: "attachment";
  parameters: {
    subject?: UnitRef;
    role: "leading" | "led" | "attached";
    with?: UnitFilter;
  };
}
/**
 * [composition] The subject is below its Starting Strength, or below Half-strength.
 */
export interface StrengthCondition {
  type: "strength";
  parameters: {
    subject?: UnitRef;
    below: "starting" | "half";
  };
}
/**
 * [composition] The subject has this many models (with `keyword`, if given).
 */
export interface ModelCountCondition {
  type: "model-count";
  parameters: {
    [k: string]: unknown;
  };
}
/**
 * [composition] The subject model uses this datasheet model profile (Szarekh, not a Triarchal Menhir).
 */
export interface ModelProfileCondition {
  type: "model-profile";
  parameters: {
    subject?: UnitRef;
    profile: EntityId;
  };
}
/**
 * [composition] lost: the subject has lost wounds. remaining_max: it has at most this many left ({rating: true}: the unit's printed rating, as core Damaged X reads it). damaged: it is in its datasheet's Damaged bracket.
 */
export interface WoundsCondition {
  type: "wounds";
  parameters: {
    [k: string]: unknown;
  };
}
/**
 * [composition] Each model (with model_keyword, if given) carries identical weapons of this kind.
 */
export interface LoadoutCondition {
  type: "loadout";
  parameters: {
    subject?: UnitRef;
    model_keyword?: Keyword;
    uniform: "ranged" | "melee";
  };
}
/**
 * [state] The subject is in this core-rules state. `with` narrows engaged to one unit; `at` reads the state at an earlier point.
 */
export interface UnitStateCondition {
  type: "unit-state";
  parameters: {
    subject?: UnitRef;
    state: UnitState;
    with?: UnitRef;
    at?: "now" | "phase-start" | "turn-start";
  };
}
/**
 * [state] The subject is eligible to do this. be-selected: eligible for `source_ability`'s selection.
 */
export interface EligibleCondition {
  type: "eligible";
  parameters: {
    subject?: UnitRef;
    to: "shoot" | "declare-charge" | "fight" | "start-action" | "be-selected";
    source_ability?: {
      ability_id: EntityId;
      owner?: "friendly" | "enemy";
    };
    at?: "now" | "opponents-previous-turn-end";
  };
}
/**
 * [history] An event happened within `window`: the subject did it, to the object, matching the filter, at least count_min times (default 1).
 */
export interface HappenedCondition {
  type: "happened";
  parameters: {
    event: GameEvent;
    subject?: UnitRef;
    object?: EventTarget;
    filter?: EventFilter;
    window: HistoryWindow;
    count_min?: number;
    count_max?: number;
    proximity?: {
      of?: UnitRef;
      range: RangeRef;
    };
  };
}
/**
 * [history] Compares how many times two events happened (mission cards).
 */
export interface HappenedCompareCondition {
  type: "happened-compare";
  parameters: {
    left: {
      event: GameEvent;
      subject?: UnitRef;
      object?: EventTarget;
      filter?: EventFilter;
      window: HistoryWindow;
    };
    comparison: "greater-than" | "greater-or-equal";
    right:
      | {
          event: GameEvent;
          subject?: UnitRef;
          object?: EventTarget;
          filter?: EventFilter;
          window: HistoryWindow;
        }
      | {
          value: number;
        }
      | {
          pool: string;
        };
  };
}
/**
 * [position] The subject is within `range` of `of`. models: every means every model of the subject; wholly means wholly within. `at` reads the position at an earlier point.
 */
export interface WithinCondition {
  type: "within";
  parameters: {
    subject?: UnitRef;
    of: PlaceRef;
    range?: RangeRef;
    wholly?: true;
    models?: "any" | "every";
    at?: "now" | "phase-start";
    count_min?: number;
  };
}
/**
 * [position] The subject is inside a region (wholly, if set).
 */
export interface InRegionCondition {
  type: "in-region";
  parameters: {
    subject?: UnitRef;
    region: RegionRef;
    wholly?: true;
    models?: "any" | "every";
  };
}
/**
 * [position] The subject is the closest of `among` to `to` (default the attacker), within `range` if given.
 */
export interface ClosestCondition {
  type: "closest";
  parameters: {
    subject?: UnitRef;
    among: "eligible-targets" | UnitFilter;
    to?: UnitRef;
    range?: RangeRef;
  };
}
/**
 * [board] A player (default you) controls objectives matching the filter: at least count_min (default 1), at most count_max. compare: more-than-opponent means more objectives than the opponent.
 */
export interface ControlsCondition {
  type: "controls";
  parameters?: {
    by?: "friendly" | "enemy";
    objective?: ObjectiveFilter;
    count_min?: number;
    count_max?: number;
    compare?: "more-than-opponent";
  };
}
/**
 * [attack] The attack being resolved matches every filter.
 */
export interface AttackIsCondition {
  type: "attack-is";
  parameters: {
    attack_type?: "ranged" | "melee" | "psychic";
    shooting_type?: "normal" | "assault" | "close-quarters" | "indirect" | "snap";
    fight_type?: "normal" | "overrun";
    weapon_keyword?: string;
    weapon_name?: string;
    all_target_same_unit?: true;
  };
}
/**
 * [attack] Compares a stat of one side of the attack with a stat of the other, or with a value.
 */
export interface AttackCompareCondition {
  type: "attack-compare";
  parameters: {
    left: {
      of: "attacker" | "defender";
      stat: string;
      reduce?: "max" | "min";
    };
    comparison: "greater-than" | "less-than" | "equal-to" | "greater-or-equal" | "less-or-equal";
    right:
      | {
          of: "attacker" | "defender";
          stat: string;
          reduce?: "max" | "min";
        }
      | {
          value: number;
        };
  };
}
/**
 * [attack] A roll came out this way.
 */
export interface RollResultCondition {
  type: "roll-result";
  parameters: {
    roll: RollKind;
    result: RollOutcome;
    source?: EventBoundReference;
  };
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "event-bound-reference".
 */
export interface EventBoundReference {
  event_var: string;
}
/**
 * [visibility] The subject is visible (fully visible, if set) to `to` (default the attacker). With blocked_by, the view is instead blocked by that unit.
 */
export interface VisibleCondition {
  type: "visible";
  parameters?: {
    subject?: UnitRef;
    to?: UnitRef;
    fully?: true;
    /**
     * Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.
     */
    blocked_by?:
      | (
          | "this-unit"
          | "this-model"
          | "model-in-this-unit"
          | "attacker"
          | "defender"
          | "event-subject"
          | "event-object"
          | "stratagem-target"
          | "selected-unit"
          | "recipient"
          | "bearer-transport"
          | "ability-unit"
        )
      | UnitFilter
      | {
          event_var: string;
        }
      | {
          selection_var: string;
        }
      | {
          stratagem_target: EntityId;
        };
  };
}
/**
 * [designation] The subject carries this designation. With count_min/count_max, counts how many units or objectives carry it.
 */
export interface DesignatedCondition {
  type: "designated";
  parameters: {
    subject?:
      | UnitRef
      | {
          objective: ObjectiveFilter;
        };
    tag: DesignationId;
    count_min?: number;
    count_max?: number;
    /**
     * Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.
     */
    by?:
      | (
          | "this-unit"
          | "this-model"
          | "model-in-this-unit"
          | "attacker"
          | "defender"
          | "event-subject"
          | "event-object"
          | "stratagem-target"
          | "selected-unit"
          | "recipient"
          | "bearer-transport"
          | "ability-unit"
        )
      | UnitFilter
      | {
          event_var: string;
        }
      | {
          selection_var: string;
        }
      | {
          stratagem_target: EntityId;
        };
  };
}
/**
 * [resource] A resource pool holds at least / at most this much. below_max: fewer uses than its maximum have been spent.
 */
export interface ResourceCondition {
  type: "resource";
  parameters: {
    pool: string;
    at_least?: number;
    at_most?: number;
    below_max?: true;
    source_ability?: {
      ability_id: EntityId;
      owner?: "friendly" | "enemy";
    };
    at?: "now" | "opponents-previous-turn-end";
  };
}
/**
 * [board] Mission: operation markers on the battlefield.
 */
export interface OperationMarkersCondition {
  type: "operation-markers";
  parameters?: {
    side?: "friendly" | "opponent";
    count_min?: number;
    count_max?: number;
    friendly_unit_in_same_terrain_area?: true;
    no_enemy_in_terrain_area?: true;
    within_range_of?: "opponent-home-objective";
  };
}
/**
 * [board] Mission: you are engaged on at least count_min fronts.
 */
export interface EngagementFrontsCondition {
  type: "engagement-fronts";
  parameters: {
    count_min: number;
  };
}
/**
 * [board] Mission: enemy units destroyed on, or by a unit on, an objective.
 */
export interface DestroyedWhileOnObjectiveCondition {
  type: "destroyed-while-on-objective";
  parameters?: {
    count_min?: number;
    objective_role?: "central" | "expansion";
    destroyer_on_objective?: true;
    victim_on_objective?: true;
    victim_started_turn_on_objective?: true;
  };
}
/**
 * [board] Mission: enemy units destroyed in (or that started the turn in) designated terrain.
 */
export interface DestroyedInTaggedTerrainCondition {
  type: "destroyed-in-tagged-terrain";
  parameters?: {
    count_min?: number;
    tag?: string;
    at_start_of_turn?: true;
  };
}
/**
 * [clock] The battle is being played at this battle size.
 */
export interface BattleSizeCondition {
  type: "battle-size";
  parameters: {
    size: "incursion" | "strike-force" | "onslaught";
  };
}
/**
 * [army] Your Army Faction is this faction.
 */
export interface ArmyFactionCondition {
  type: "army-faction";
  parameters: {
    faction: EntityId;
  };
}
/**
 * [history] The subject (default the unit being checked) was moved over by `by` during that move (window event) or in the window.
 */
export interface MovedOverCondition {
  type: "moved-over";
  parameters: {
    subject?: UnitRef;
    by: UnitRef;
    window?: HistoryWindow;
  };
}
/**
 * [designation] The subject (default this unit) is Guided: it has For the Greater Good, is not an Observer, and is targeting one or more Spotted units.
 */
export interface GuidedCondition {
  type: "guided";
  parameters: {
    subject?: UnitRef;
  };
}
/**
 * [characteristic] Change a characteristic of the target's models or their weapons. incoming: the change applies to attacks made against the target.
 */
export interface StatModifierEffect {
  type: "stat-modifier";
  target: UnitRef;
  modifier: {
    stat:
      | "M"
      | "T"
      | "Sv"
      | "W"
      | "Ld"
      | "OC"
      | "A"
      | "WS"
      | "BS"
      | "S"
      | "AP"
      | "D"
      | "Range"
      | "detection-range"
      | "psyker-level";
    operation: "add" | "subtract" | "set" | "improve" | "worsen" | "multiply" | "halve";
    value?: Quantity;
    weapon_type?: "melee" | "ranged";
    weapon_name?: string;
    weapon_keyword?: string;
    weapon_ref?:
      | {
          weapon_var: string;
        }
      | {
          selected_by: {
            ability: EntityId;
          };
        };
    incoming?: true;
    minimum?: number;
    maximum?: number;
  };
  scaling?: Scaling;
}
/**
 * Scales a numeric modifier field (`field`, default `value`): it applies once per `per` of `of` (rounding `round`, default down), optionally capped at `max_value`. E.g. '+2 to the Attacks characteristic for every 5 enemy models within 6"' -> modifier.value 2 with scaling { per: 5, of: 'enemy-models-in-range', within_inches: 6 }.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "scaling".
 */
export interface Scaling {
  per: number;
  of: ScalingSource;
  within_inches?: number;
  round?: "down" | "up";
  max_value?: number;
  /**
   * The modifier field the scaling multiplies (default value): count for re-roll/return-models, modifier for a test's penalty.
   */
  field?: "value" | "count" | "amount" | "distance" | "modifier" | "max_models";
  /**
   * Only models with this keyword are counted.
   */
  keyword?: string;
  /**
   * Kebab-case identifier
   */
  wargear?: string;
}
/**
 * [characteristic] Ignore modifiers to characteristics or rolls (all of them, or only worsening ones).
 */
export interface IgnoreModifiersEffect {
  type: "ignore-modifiers";
  target: UnitRef;
  modifier: {
    what: "characteristics" | "rolls";
    /**
     * @minItems 1
     */
    stats?: [
      (
        | "M"
        | "T"
        | "Sv"
        | "W"
        | "Ld"
        | "OC"
        | "A"
        | "WS"
        | "BS"
        | "S"
        | "AP"
        | "D"
        | "Range"
        | "detection-range"
        | "psyker-level"
      ),
      ...(
        | "M"
        | "T"
        | "Sv"
        | "W"
        | "Ld"
        | "OC"
        | "A"
        | "WS"
        | "BS"
        | "S"
        | "AP"
        | "D"
        | "Range"
        | "detection-range"
        | "psyker-level"
      )[]
    ];
    /**
     * @minItems 1
     */
    rolls?: [
      (
        | (
            | "hit"
            | "wound"
            | "save"
            | "damage"
            | "charge"
            | "advance"
            | "battle-shock"
            | "leadership"
            | "hazard"
            | "psychic"
            | "desperate-escape"
            | "deadly-demise"
            | "attacks"
            | "normal-move"
            | "surge"
            | "dark-pact"
            | "blessings-of-khorne"
            | "resource-die"
            | "manoeuvre"
            | "channelling"
            | "any"
            | "all"
          )
        | AbilityRoll
      ),
      ...(
        | (
            | "hit"
            | "wound"
            | "save"
            | "damage"
            | "charge"
            | "advance"
            | "battle-shock"
            | "leadership"
            | "hazard"
            | "psychic"
            | "desperate-escape"
            | "deadly-demise"
            | "attacks"
            | "normal-move"
            | "surge"
            | "dark-pact"
            | "blessings-of-khorne"
            | "resource-die"
            | "manoeuvre"
            | "channelling"
            | "any"
            | "all"
          )
        | AbilityRoll
      )[]
    ];
    only?: "worsening" | "improving";
    weapon_type?: "melee" | "ranged";
    weapon_name?: string;
    weapon_keyword?: string;
    weapon_ref?:
      | {
          weapon_var: string;
        }
      | {
          selected_by: {
            ability: EntityId;
          };
        };
    incoming?: true;
  };
  scaling?: Scaling;
}
/**
 * [roll] Add to or subtract from a roll. cap bounds a stacking modifier; value_from takes the value from an earlier step's roll.
 */
export interface RollModifierEffect {
  type: "roll-modifier";
  target: UnitRef;
  modifier: {
    roll:
      | (
          | "hit"
          | "wound"
          | "save"
          | "damage"
          | "charge"
          | "advance"
          | "battle-shock"
          | "leadership"
          | "hazard"
          | "psychic"
          | "desperate-escape"
          | "deadly-demise"
          | "attacks"
          | "normal-move"
          | "surge"
          | "dark-pact"
          | "blessings-of-khorne"
          | "resource-die"
          | "manoeuvre"
          | "channelling"
          | "any"
          | "all"
        )
      | AbilityRoll;
    operation: "add" | "subtract";
    value?: Quantity;
    cap?: number;
    value_from?: "previous-roll";
    weapon_type?: "melee" | "ranged";
    weapon_name?: string;
    weapon_keyword?: string;
    weapon_ref?:
      | {
          weapon_var: string;
        }
      | {
          selected_by: {
            ability: EntityId;
          };
        };
    incoming?: true;
  };
  scaling?: Scaling;
}
/**
 * [roll] Re-roll a roll: only 1s, every failure, or any result; count caps how many. mandatory: the rule re-rolls (it does not only permit one).
 */
export interface ReRollEffect {
  type: "re-roll";
  target: UnitRef;
  modifier: {
    [k: string]: unknown;
  };
  scaling?: Scaling;
}
/**
 * [roll] Fix a roll's result (pass, fail or a value; unmodified: it counts as that unmodified result), make it succeed only on an unmodified N+, fail on an unmodified N or less, or make it critical on N+ or on any success.
 */
export interface RollResultEffect {
  type: "roll-result";
  target: UnitRef;
  modifier: {
    [k: string]: unknown;
  };
  scaling?: Scaling;
}
/**
 * [roll] The attack sequence ends for that attack.
 */
export interface EndAttackSequenceEffect {
  type: "end-attack-sequence";
  target: UnitRef;
  modifier?: {};
  scaling?: Scaling;
}
/**
 * [ability] Give the target a named ability: a core ability or an ability record. value is its rating (Scouts 6", Firing Deck 2).
 */
export interface AbilityGrantEffect {
  type: "ability-grant";
  target: UnitRef;
  modifier: {
    ability: EntityId;
    value?: number | UnitRating;
    rules_bundle?: true;
  };
  scaling?: Scaling;
}
/**
 * [ability] Give the target unit keywords, optionally replacing others.
 */
export interface KeywordGrantEffect {
  type: "keyword-grant";
  target: UnitRef;
  modifier: {
    keywords: KeywordList;
    replaces?: KeywordList;
  };
  scaling?: Scaling;
}
/**
 * [ability] Give the target's weapons weapon abilities. if_present: increment raises an ability the weapon already has by the granted rating.
 */
export interface WeaponAbilityGrantEffect {
  type: "weapon-ability-grant";
  target: UnitRef;
  modifier: {
    /**
     * @minItems 1
     */
    abilities: [string, ...string[]];
    weapon_type?: "melee" | "ranged";
    weapon_name?: string;
    weapon_keyword?: string;
    weapon_ref?:
      | {
          weapon_var: string;
        }
      | {
          selected_by: {
            ability: EntityId;
          };
        };
    if_present?: "increment";
    incoming?: true;
  };
  scaling?: Scaling;
}
/**
 * [ability] Equip the target with a weapon.
 */
export interface WeaponGrantEffect {
  type: "weapon-grant";
  target: UnitRef;
  modifier: {
    weapon_id: EntityId;
    count?: number;
  };
  scaling?: Scaling;
}
/**
 * [ability] Change one named ability: its uses, range, targets, recipients, selections, how many can apply at once, duration, start round, threshold or options.
 */
export interface AbilityModifierEffect {
  type: "ability-modifier";
  target: UnitRef;
  modifier: {
    ability:
      | EntityId
      | {
          affecting: UnitFilter;
        }
      | {
          event: "used";
        }
      | {
          keyword: string;
        };
    aspect:
      | "uses"
      | "range"
      | "targets"
      | "recipients"
      | "selections"
      | "concurrent"
      | "duration"
      | "start-round"
      | "end-round"
      | "threshold"
      | "options";
    operation: "add" | "subtract" | "set" | "lift-limit";
    value?: number | string;
    cap?: number;
    recipients?: UnitFilter;
    add_option?: {
      name: string;
      effect: EffectNode;
    };
    /**
     * The changed allowance still applies at most count times per period (two uses, but only one per battle round).
     */
    cap_per?: {
      count: number;
      period: "phase" | "turn" | "battle-round";
    };
    /**
     * The extra use cannot be made in the same phase (turn) as the use that triggered it.
     */
    not_same?: "phase" | "turn";
    /**
     * This unit's use does not count toward the shared (once per phase per army) limit for other units.
     */
    consumes_shared_use?: false;
  };
  scaling?: Scaling;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "stance-select-effect".
 */
export interface StanceSelectEffect {
  type: "stance-select";
  mode: "re-selectable" | "consumable";
  scope?: "army" | "unit";
  select?: string;
  /**
   * @minItems 2
   */
  options: [
    {
      name: string;
      effect: EffectNode;
    },
    {
      name: string;
      effect: EffectNode;
    },
    ...{
      name: string;
      effect: EffectNode;
    }[]
  ];
  /**
   * Fewest options picked at once; defaults to one.
   */
  min_choices?: number;
  /**
   * Most options picked at once; defaults to one.
   */
  max_choices?: number;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "stance-selection-capacity-effect".
 */
export interface StanceSelectionCapacityEffect {
  type: "stance-selection-capacity";
  scope?: "army" | "unit";
  modifier: {
    stance_id: EntityId;
    additional_selections: number;
    allocation: "choose-one-option" | "fixed-option";
    option_id?: EntityId;
  };
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "choice-effect".
 */
export interface ChoiceEffect {
  type: "choice";
  /**
   * @minItems 2
   */
  options: [EffectNode, EffectNode, ...EffectNode[]];
  choice_label?: string;
  choice_prompt?: string;
  /**
   * Minimum number of distinct options selected at this activation; defaults to one.
   */
  min_choices?: number;
  /**
   * Maximum number of distinct options selected at this activation; defaults to one.
   */
  max_choices?: number;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "sequence-effect".
 */
export interface SequenceEffect {
  type: "sequence";
  /**
   * @minItems 1
   */
  steps: [EffectNode, ...EffectNode[]];
  [k: string]: unknown;
}
/**
 * A reusable named ability's complete effect bundle. Other abilities grant it through an ability-grant effect whose modifier.ability names the containing ability.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "rules-bundle-effect".
 */
export interface RulesBundleEffect {
  type: "rules-bundle";
  /**
   * @minItems 1
   */
  steps: [EffectNode, ...EffectNode[]];
}
/**
 * One part of a compound ability: an effect with its own moment (trigger), usage limit, cost or choice, shown as one bullet of the ability it belongs to. The ability's own trigger is its firing moment; a part's trigger is the moment of that part alone, in the same trigger shape. `name` is only for a part the rules name (a psychic power, a named rule in a bundle).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "ability-part".
 */
export interface AbilityPart {
  type: "ability-part";
  /**
   * The part's own name, only when the rules give it one.
   */
  name?: string;
  kind?: "psychic";
  level?: number;
  effect: EffectNode;
  /**
   * Whether the controlling player may decline this part.
   */
  optional?: boolean;
  /**
   * A prerequisite cost: the part's effect applies only after this complete cost is paid. An optional part may be declined without paying it.
   */
  cost?:
    | SingleEffect
    | StanceSelectEffect
    | StanceSelectionCapacityEffect
    | ChoiceEffect
    | SequenceEffect
    | RulesBundleEffect
    | AbilityPart
    | DiceGatedEffect
    | DiceTableEffect
    | ConditionalEffect
    | DicePoolAllocationEffect
    | SelectUnitsEffect
    | ForEachUnitEffect
    | AuraEffect
    | DesignateTargetEffect
    | RiskRewardEffect
    | IssueOrdersEffect
    | ResourceActionMenuEffect
    | NamedRegionStateEffect
    | LeaderModelAbilityGrantEffect
    | PersistentDesignationEffect
    | NoEffectEffect
    | RollEffect
    | SelectObjectiveEffect;
  /**
   * How long an effect, a part or a designation lasts; the one expiry vocabulary for scope.duration, ability-part.duration, designate.clears_on and the designation containers. attack-sequence expires when the currently selected unit finishes resolving its shooting or fighting attacks; resolution lasts only while resolving this activation and is not a battle/phase usage limit; until-this-unit-has-shot ends once the unit with the ability has resolved its ranged attacks; control-lost ends when you stop controlling the designated objective. one-use is retired (use usage n-per-battle) and leaves the enum once no record carries it.
   */
  duration?:
    | "phase"
    | "turn"
    | "battle-round"
    | "battle"
    | "until-next-command-phase"
    | "until-next-movement-phase"
    | "until-next-battle-round"
    | "until-start-next-turn"
    | "one-use"
    | "permanent"
    | "attack-sequence"
    | "resolution"
    | "until-next-shooting-phase"
    | "until-end-of-your-next-turn"
    | "until-end-of-opponent-next-turn"
    | "until-this-unit-has-shot"
    | "control-lost";
  /**
   * The moment this part fires on, in the ability trigger's shape. When the part sits inside an activated effect, it applies only for the enclosing effect's duration.
   */
  trigger?: Trigger | [Trigger, ...Trigger[]];
  /**
   * How often this part may be used, when the limit is the part's and not the whole ability's.
   */
  usage?: AbilityUsageLimit | [AbilityUsageLimit, AbilityUsageLimit, ...AbilityUsageLimit[]];
}
/**
 * The result of a roll an enclosing `roll` step bound: its total, or (with successes_on) how many of its dice rolled that value or higher.
 */
export interface RollReference1 {
  roll_var: string;
  successes_on?: number;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "dice-requirement".
 */
export interface DiceRequirement {
  type: "pair" | "triple" | "single" | "run";
  min_value: number;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "dice-table-effect".
 */
export interface DiceTableEffect {
  type: "dice-table";
  /**
   * One closed die whose faces are covered exactly once by outcomes.
   */
  dice: "D3" | "D6";
  /**
   * Roll this many dice and resolve each one on the table.
   */
  count?: number;
  /**
   * Each outcome applies at most once; a repeated result is re-rolled.
   */
  distinct?: true;
  /**
   * @minItems 2
   */
  outcomes: [
    {
      /**
       * @minItems 1
       */
      results: [number, ...number[]];
      effect: EffectNode;
    },
    {
      /**
       * @minItems 1
       */
      results: [number, ...number[]];
      effect: EffectNode;
    },
    ...{
      /**
       * @minItems 1
       */
      results: [number, ...number[]];
      effect: EffectNode;
    }[]
  ];
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "conditional-effect".
 */
export interface ConditionalEffect {
  type: "conditional";
  condition: AbilityDSLCondition2;
  effect: EffectNode;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "dice-pool-allocation-effect".
 */
export interface DicePoolAllocationEffect {
  type: "dice-pool-allocation";
  pool: {
    count: number;
    die: string;
    [k: string]: unknown;
  };
  max_activations: number;
  /**
   * @minItems 1
   */
  options: [
    {
      name: string;
      requirement: DiceRequirementSpec;
      effect: EffectNode;
      [k: string]: unknown;
    },
    ...{
      name: string;
      requirement: DiceRequirementSpec;
      effect: EffectNode;
      [k: string]: unknown;
    }[]
  ];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "select-units-effect".
 */
export interface SelectUnitsEffect {
  type: "select-units";
  /**
   * Legacy selectors omit min_count and retain up-to semantics. Bounded authoring requires min_count, max_count, and owner, with min_count <= max_count.
   */
  selector: {
    [k: string]: unknown;
  };
  effect: EffectNode;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "for-each-unit-effect".
 */
export interface ForEachUnitEffect {
  type: "for-each-unit";
  selector: {
    owner: "friendly" | "enemy";
    /**
     * Keywords filtered against each candidate. Under the default `keyword_match` every listed keyword is required; under `any`, a candidate qualifies on any one of them.
     *
     * @minItems 1
     */
    keywords?: [string, ...string[]];
    /**
     * Whether `keywords` is a conjunction (the default, preserving historical AND semantics) or an honest disjunction.
     */
    keyword_match?: "all" | "any";
    /**
     * Whether each iteration binds a whole unit or one matching model.
     */
    target_kind?: "unit" | "model";
    within_inches?: number;
    /**
     * Candidate engagement relation to the bearer or bearer-unit.
     */
    engagement_relation?: "engaged-with-bearer" | "not-engaged-with-bearer";
    /**
     * Origin of the engagement_relation gate.
     */
    reference?: "bearer" | "bearer-unit" | "bearer-transport";
    /**
     * Restrict candidates to models in the ability bearer's unit, including an Attached unit. With target_kind:model every listed keyword is tested on that individual model, never the union of unit keywords.
     */
    member_of?: "bearer-unit";
    /**
     * Exact model-profile names; alternatives. Filters individual models, never the union of unit keywords.
     *
     * @minItems 1
     */
    model_names?: [string, ...string[]];
    /**
     * A candidate with any listed keyword is excluded.
     *
     * @minItems 1
     */
    excluded_keywords?: [string, ...string[]];
    bind_as?: string;
    eligibility?: AbilityDSLCondition2;
    within_objective?: SelectionReference;
  };
  effect: EffectNode;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "selection-reference".
 */
export interface SelectionReference {
  selection_var: string;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "aura-effect".
 */
export interface AuraEffect {
  type: "aura";
  target: "enemy-within-aura" | "friendly-within-aura";
  modifier: {
    range?: number | [number, ...number[]];
    range_bonus?: number;
    of?: string;
    effect?: EffectNode;
    eligible?: {
      /**
       * @minItems 1
       */
      required_keywords?: [string, ...string[]];
      /**
       * @minItems 1
       */
      excluded_keywords?: [string, ...string[]];
    };
    emitter_filter?: KeywordFilter;
    recipient_filter?: KeywordFilter;
    /**
     * The aura range, extensions included, never exceeds this.
     */
    range_cap?: number;
  };
}
/**
 * Independent keyword predicate for the aura emitter or each aura recipient. Required keywords all match; excluded keywords none match.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "keyword-filter".
 */
export interface KeywordFilter {
  /**
   * @minItems 1
   */
  required_keywords: [string, ...string[]];
  /**
   * @minItems 1
   */
  excluded_keywords?: [string, ...string[]];
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "designate-target-effect".
 */
export interface DesignateTargetEffect {
  type: "designate-target";
  designation: string;
  select: {
    scope: "enemy-unit" | "friendly-unit";
    count?: number;
    timing?: string;
    within_inches?: number;
    /**
     * Explicit built-in origin of range and visibility gates, matching select-units. bearer-transport measures from the Transport the origin unit is embarked within.
     */
    reference?: "bearer" | "bearer-unit" | "bearer-transport";
    visibility_required?: boolean;
    /**
     * @minItems 1
     */
    keywords?: [string, ...string[]];
    keyword_match?: "all" | "any";
    eligibility?: AbilityDSLCondition3;
    visible_to?: SelectionReference;
    /**
     * @minItems 1
     */
    excluded_keywords?: [string, ...string[]];
    bind_as?: string;
    within_inches_from?: SelectionReference;
    /**
     * Maximum selections of this same target by this ability across the whole army in the named period.
     */
    selection_limit?: {
      count: number;
      period: "phase" | "turn" | "battle-round" | "battle";
    };
  };
  applies: {
    to: "target" | "attackers-of-target" | "bearer-attacks-target" | "bound-unit-attacks-reference";
    effect: EffectNode;
    /**
     * All keywords required on each individual friendly attacking MODEL, not on its unit. Only meaningful with to:attackers-of-target.
     *
     * @minItems 1
     */
    attacker_keywords?: [string, ...string[]];
    /**
     * All keywords required on the attacking model's UNIT, including attached-unit keyword unions. Does not require those keywords on the individual model. Only meaningful with to:attackers-of-target.
     *
     * @minItems 1
     */
    attacker_unit_keywords?: [string, ...string[]];
    beneficiary?: EventOrSelectionReference;
    reference?: SelectionReference;
  };
  duration?: ScopeDuration;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "risk-reward-effect".
 */
export interface RiskRewardEffect {
  type: "risk-reward";
  reward: EffectNode;
  risk: {
    test: string;
    on_fail: EffectNode;
  };
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "issue-orders-effect".
 */
export interface IssueOrdersEffect {
  type: "issue-orders";
  count?: number;
  range?: number;
  eligible?: {
    keyword?: string;
  };
  /**
   * @minItems 1
   */
  options: [
    {
      name: string;
      effect: EffectNode;
    },
    ...{
      name: string;
      effect: EffectNode;
    }[]
  ];
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "resource-action-menu-effect".
 */
export interface ResourceActionMenuEffect {
  type: "resource-action-menu";
  menu_id: string;
  pool_id: string;
  shared_usage?: {
    unit_max_manoeuvres_per_phase?: number;
    default_manoeuvre_max_per_phase?: number;
  };
  capacity?: {
    amount: number;
    resource_label: string;
    ability_noun: string;
    refresh: "battle-round" | "turn" | "phase" | "battle";
  };
  /**
   * @minItems 1
   */
  actions: [
    {
      id: string;
      label: string;
      when: ResourceActionMenuTrigger | [ResourceActionMenuTrigger, ...ResourceActionMenuTrigger[]];
      cost: {
        pool_id: string;
        amount: number;
        resource_label?: string;
      };
      eligibility?: {
        /**
         * @minItems 1
         */
        requires_keyword?: [string, ...string[]];
        /**
         * @minItems 1
         */
        excludes_keyword?: [string, ...string[]];
        selector_count?: number;
        /**
         * @minItems 1
         */
        requires?: [AbilityDSLCondition2, ...AbilityDSLCondition2[]];
      };
      usage?: {
        repeatable_if_different_unit?: boolean;
      };
      duration?: "immediate" | "until-end-of-phase" | "until-end-of-turn";
      effect: EffectNode;
    },
    ...{
      id: string;
      label: string;
      when: ResourceActionMenuTrigger | [ResourceActionMenuTrigger, ...ResourceActionMenuTrigger[]];
      cost: {
        pool_id: string;
        amount: number;
        resource_label?: string;
      };
      eligibility?: {
        /**
         * @minItems 1
         */
        requires_keyword?: [string, ...string[]];
        /**
         * @minItems 1
         */
        excludes_keyword?: [string, ...string[]];
        selector_count?: number;
        /**
         * @minItems 1
         */
        requires?: [AbilityDSLCondition2, ...AbilityDSLCondition2[]];
      };
      usage?: {
        repeatable_if_different_unit?: boolean;
      };
      duration?: "immediate" | "until-end-of-phase" | "until-end-of-turn";
      effect: EffectNode;
    }[]
  ];
}
/**
 * A single reactive trigger: an event family (`event`), who acted (`subject`, default this-unit; clock events have none), what the action was aimed at (`object`), which one (`filter`: the move, roll, Stratagem or ability), a spatial gate (`proximity`), an extra gate (`condition`, where phase and turn go), `optional` for 'you can' reactions, a CP `cost`, and the `window` a granted reaction stays open.
 */
export interface ResourceActionMenuTrigger {
  event: GameEvent;
  subject?: UnitRef;
  object?: UnitRef;
  filter?: EventFilter;
  /**
   * The event happened within range of `of` (default this-unit).
   */
  proximity?: {
    of?: UnitRef;
    range: RangeRef;
  };
  condition?: AbilityDSLCondition2;
  optional?: boolean;
  cost?: {
    cp?: number;
  };
  window?: string;
  binds_event_variable?: string;
  /**
   * Binds the generated Miracle die identity from a resource-generation trigger; consumers refer only as {die_var: ID}.
   */
  binds_die_variable?: string;
  /**
   * Binds the controller-selected Miracle die among those used in the triggering Act of Faith; consumers refer only as {die_var: ID}.
   */
  binds_selected_die_variable?: string;
  /**
   * The ability whose selection fired a `targets-selected {kind: ability}` trigger. Required there and allowed nowhere else.
   */
  source_ability?: {
    ability_id: EntityId;
    owner: "friendly" | "enemy";
    /**
     * All keywords required on the unit using the named source ability, not on the selected target.
     *
     * @minItems 1
     */
    keywords: [string, ...string[]];
  };
}
/**
 * A named battlefield region: who produces it, what it does to units inside it, and when.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-state-effect".
 */
export interface NamedRegionStateEffect {
  type: "named-region-state";
  target?: UnitRef;
  modifier: NamedRegionState;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-state".
 */
export interface NamedRegionState {
  region_ref: NamedRegionRef;
  producer: NamedRegionProducer;
  consumer: NamedRegionConsumer;
  branch_precedence: "qualified-replaces-default";
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-ref".
 */
export interface NamedRegionRef {
  region_id: string;
  owner_faction: string;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-producer".
 */
export interface NamedRegionProducer {
  region_ref: NamedRegionRef;
  mode: "complete" | "extension";
  parent_ref: NamedRegionRef | null;
  baseline: NamedRegionBaseline[];
  phase_extensions: NamedRegionPhaseExtension[];
  additive_extensions: {
    kind: string;
    source_gate: NamedRegionSourceGate;
    radius_inches?: number;
    activation?: {
      event: "continuous";
    };
    [k: string]: unknown;
  }[];
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-baseline".
 */
export interface NamedRegionBaseline {
  kind: "fixed-zone";
  zone: "own-deployment-zone";
  activation: {
    event: "always-active";
  };
  expiry: {
    event: "never";
  };
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-phase-extension".
 */
export interface NamedRegionPhaseExtension {
  kind: "objective-majority-zone";
  zone: "no-mans-land" | "opponent-deployment-zone";
  control_gate: {
    marker_scope: "markers-in-zone";
    controlled_by: "owner-army";
    threshold: {
      comparison: "at-least";
      fraction: 0.5;
    };
  };
  activation: {
    event: "phase-start";
    evaluation: "snapshot-once";
    canonical_condition_ids: ["controls"];
  };
  expiry: {
    event: "phase-end";
  };
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-source-gate".
 */
export interface NamedRegionSourceGate {
  gate_ref: string;
  owner: string;
  unit_predicate: {
    faction: string;
    /**
     * @minItems 1
     */
    keywords: [string, ...string[]];
  };
  range_to_marker_inches?: number;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-consumer".
 */
export interface NamedRegionConsumer {
  state_ref: NamedRegionRef;
  beneficiary_gate: {
    owner: string;
    faction?: string;
    operator: "and" | "or";
    /**
     * @minItems 1
     */
    keywords: [string, ...string[]];
    [k: string]: unknown;
  };
  membership: NamedRegionMembership;
  qualified_condition: AbilityDSLCondition2;
  default_branch: NamedRegionBranch;
  qualified_branch: NamedRegionBranch;
  attack_condition?: AbilityDSLCondition4;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-membership".
 */
export interface NamedRegionMembership {
  unit_scope: "model" | "whole-unit";
  relation: string;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-branch".
 */
export interface NamedRegionBranch {
  source: NamedRegionBranchActor;
  beneficiary: NamedRegionBranchActor;
  target: UnitRef;
  timing: NamedRegionBranchTiming;
  duration: string;
  effect: EffectNode;
  optional: boolean;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-branch-actor".
 */
export interface NamedRegionBranchActor {
  role: string;
  gate_ref: string;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-region-branch-timing".
 */
export interface NamedRegionBranchTiming {
  event: string;
}
/**
 * Resolve the attached qualifying leader model and dispatch a targetless effect to that model while it leads the bearer unit.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "leader-model-ability-grant-effect".
 */
export interface LeaderModelAbilityGrantEffect {
  type: "leader-model-ability-grant";
  source: "bearer-unit";
  beneficiary: "leading-leader-model" | "attached-character-leader";
  leader_filter?: {
    identity?: string;
    /**
     * @minItems 1
     */
    keywords?: [string, ...string[]];
  };
  attached_unit_filter: [string, ...string[]] | null;
  duration: "while-leading";
  grant: {
    recipient: "beneficiary";
    effect: BeneficiaryBoundEffectNode;
  };
  recipient_binding: "beneficiary-only";
}
/**
 * Targetless effect dispatched to a relation-resolved beneficiary model; bearer and unit targets are intentionally not representable.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "beneficiary-bound-effect-node".
 */
export interface BeneficiaryBoundEffectNode {
  type: string;
  modifier?: {
    [k: string]: unknown;
  };
  scaling?: Scaling;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "persistent-designation-effect".
 */
export interface PersistentDesignationEffect {
  type: "persistent-designation";
  operation?: "establish" | "replace";
  designation: string;
  select: {
    scope: "enemy-unit" | "objective-marker";
    count?: 1;
    timing: string;
    selection_policy: "one-time" | "replace-on-destroyed";
    allow_while_embarked?: boolean;
    bind_as?: string;
  };
  /**
   * Resolve the declared bearer-model or unit beneficiary against the exact retained reference.
   */
  consumer?: {
    /**
     * Resolve this relation from the declared beneficiary to its retained unit or marker, not a generic target or nearby object.
     */
    relation: "attacks-selected-unit" | "within-selected-marker";
    beneficiary: "bearer" | "unit";
    /**
     * Nested effects apply to the declared beneficiary. An Objective Control set operation assigns the value, not a signed delta.
     */
    effect:
      | SingleEffect
      | StanceSelectEffect
      | StanceSelectionCapacityEffect
      | ChoiceEffect
      | SequenceEffect
      | RulesBundleEffect
      | AbilityPart
      | DiceGatedEffect
      | DiceTableEffect
      | ConditionalEffect
      | DicePoolAllocationEffect
      | SelectUnitsEffect
      | ForEachUnitEffect
      | AuraEffect
      | DesignateTargetEffect
      | RiskRewardEffect
      | IssueOrdersEffect
      | ResourceActionMenuEffect
      | NamedRegionStateEffect
      | LeaderModelAbilityGrantEffect
      | PersistentDesignationEffect
      | NoEffectEffect
      | RollEffect
      | SelectObjectiveEffect;
    reference?: SelectionReference;
  };
  duration: ScopeDuration;
  lifecycle?: {
    replace: {
      event: "on-unit-destroyed";
      reference: SelectionReference;
      optional: boolean;
    };
    exclusivity: "one-active-per-bearer-unit";
    expiry: "battle-end";
  };
}
/**
 * Resolve no effect; does not create attacks, damage, selections, or secondary events.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "no-effect-effect".
 */
export interface NoEffectEffect {
  type: "no-effect";
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "roll-effect".
 */
export interface RollEffect {
  type: "roll";
  dice: string;
  extra_dice_pool?: string;
  kind?: RollKind;
  roll_var: string;
  effect: EffectNode;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "select-objective-effect".
 */
export interface SelectObjectiveEffect {
  type: "select-objective";
  selector: ObjectiveSelector;
  effect: EffectNode;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "objective-selector".
 */
export interface ObjectiveSelector {
  /**
   * How many objectives are selected; each: resolve the effect once per matching objective.
   */
  count: number | "each";
  range_inches?: number;
  origin?: "bearer" | "bearer-unit";
  controlled_by?: "your-army" | "opponent";
  requires_unit?: {
    owner: "friendly" | "enemy";
    requires_ability: string;
    relation: "within-range";
  };
  selection_limit?: {
    count: number;
    period: "turn" | "phase" | "battle-round" | "battle";
  };
  bind_as: string;
  /**
   * One reference for every distance.
   */
  range?:
    | {
        inches: number;
      }
    | ("engagement" | "aura" | "weapon" | "half-weapon" | "detection" | "objective-control")
    | {
        aura_of: EntityId;
      };
  filter?: ObjectiveFilter;
}
/**
 * A single reactive trigger: an event family (`event`), who acted (`subject`, default this-unit; clock events have none), what the action was aimed at (`object`), which one (`filter`: the move, roll, Stratagem or ability), a spatial gate (`proximity`), an extra gate (`condition`, where phase and turn go), `optional` for 'you can' reactions, a CP `cost`, and the `window` a granted reaction stays open.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "trigger".
 */
export interface Trigger {
  event: GameEvent;
  subject?: UnitRef;
  object?: UnitRef;
  filter?: EventFilter;
  /**
   * The event happened within range of `of` (default this-unit).
   */
  proximity?: {
    of?: UnitRef;
    range: RangeRef;
  };
  condition?: AbilityDSLCondition2;
  optional?: boolean;
  cost?: {
    cp?: number;
  };
  window?: string;
  binds_event_variable?: string;
  /**
   * Binds the generated Miracle die identity from a resource-generation trigger; consumers refer only as {die_var: ID}.
   */
  binds_die_variable?: string;
  /**
   * Binds the controller-selected Miracle die among those used in the triggering Act of Faith; consumers refer only as {die_var: ID}.
   */
  binds_selected_die_variable?: string;
  /**
   * The ability whose selection fired a `targets-selected {kind: ability}` trigger. Required there and allowed nowhere else.
   */
  source_ability?: {
    ability_id: EntityId;
    owner: "friendly" | "enemy";
    /**
     * All keywords required on the unit using the named source ability, not on the selected target.
     *
     * @minItems 1
     */
    keywords: [string, ...string[]];
  };
}
/**
 * One usage limit: once per turn/phase/battle round, N per battle, with an optional per-army/unit/model granularity. Once per battle is frequency n-per-battle, count 1 (scope.duration one-use is retired).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "ability-usage-limit".
 */
export interface AbilityUsageLimit {
  frequency:
    | "once-per-turn"
    | "once-per-phase"
    | "once-per-battle-round"
    | "once-per-command-phase"
    | "once-per-opponent-turn"
    | "n-per-battle"
    | "first-this-battle"
    | "first-time-this-phase";
  count?: number;
  per?: "army" | "unit" | "model";
}
/**
 * [ability] Make a named ability resolve now, or make one of its options active (exclusive: only that option). select: which option is picked now (by a fresh roll, or by the player), in addition to those already active. ignore_consumed: the option may be picked even if a once-per-battle selection already used it. override: the activation resolves with this amount instead of its own.
 */
export interface AbilityActivateEffect {
  type: "ability-activate";
  target: UnitRef;
  modifier: {
    ability: EntityId;
    option?: string;
    exclusive?: true;
    select?: {
      by: "roll" | "player";
    };
    ignore_consumed?: true;
    override?: {
      amount: Quantity;
    };
  };
  scaling?: Scaling;
}
/**
 * [permission] Allow or forbid an activity. after: in a turn in which the unit made that move; despite: something that would normally block it; as_if: as if in that phase or using that shooting type; next: the unit must be the next one selected; reach: an extended distance.
 */
export interface PermissionEffect {
  type: "permission";
  target: UnitRef;
  modifier: {
    activity:
      | "shoot"
      | "declare-charge"
      | "fight"
      | "start-action"
      | "embark"
      | "disembark"
      | "fall-back"
      | "advance"
      | "use-stratagem"
      | "issue-order"
      | "attempt-ritual"
      | "use-enhancement"
      | "move"
      | "observe";
    allow: boolean;
    /**
     * @minItems 1
     */
    after?: [
      "advance" | "fall-back" | "disembark" | "normal-move" | "charge" | "remain-stationary" | "set-up",
      ...("advance" | "fall-back" | "disembark" | "normal-move" | "charge" | "remain-stationary" | "set-up")[]
    ];
    /**
     * @minItems 1
     */
    despite?: [
      (
        | "engaged"
        | "battle-shocked"
        | "shot-this-phase"
        | "fought-this-phase"
        | "disembarked-this-turn"
        | "stratagem-used-this-phase"
        | "performing-action"
        | "advanced"
        | "fell-back"
      ),
      ...(
        | "engaged"
        | "battle-shocked"
        | "shot-this-phase"
        | "fought-this-phase"
        | "disembarked-this-turn"
        | "stratagem-used-this-phase"
        | "performing-action"
        | "advanced"
        | "fell-back"
      )[]
    ];
    into?: UnitRef;
    as_if?: "shooting-phase" | "snap-shooting" | "fight-phase";
    next?: true;
    reach?: number;
    stratagem?: EntityId;
    /**
     * Doing so counts as having made this move this turn (a disembark counting as a Normal move).
     */
    counts_as_move?:
      | "normal"
      | "advance"
      | "fall-back"
      | "charge"
      | "pile-in"
      | "consolidation"
      | "surge"
      | "scout"
      | "ingress"
      | "disembark"
      | "embark"
      | "pulse-jet"
      | "remain-stationary";
    /**
     * This use of the Stratagem does not count toward its once-per-phase limit for other units.
     */
    consumes_shared_use?: false;
  };
  scaling?: Scaling;
}
/**
 * [permission] Who may, may not or must target whom, under which limit.
 */
export interface TargetingEffect {
  type: "targeting";
  target: UnitRef;
  modifier: {
    by?: UnitRef;
    may: "target" | "cannot-target" | "must-target" | "redirect";
    target?: UnitRef | "every-eligible";
    range?: RangeRef;
    kind?: "attack" | "shoot" | "fight" | "charge" | "stratagem" | "ability";
    stratagem?: EntityId;
    only_if_none?: UnitFilter;
    /**
     * Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.
     */
    to?:
      | (
          | "this-unit"
          | "this-model"
          | "model-in-this-unit"
          | "attacker"
          | "defender"
          | "event-subject"
          | "event-object"
          | "stratagem-target"
          | "selected-unit"
          | "recipient"
          | "bearer-transport"
          | "ability-unit"
        )
      | UnitFilter
      | {
          event_var: string;
        }
      | {
          selection_var: string;
        }
      | {
          stratagem_target: EntityId;
        };
    /**
     * redirect: only if `to` is an eligible target.
     */
    if_eligible?: true;
    /**
     * cannot-target with Stratagems: Core Stratagems can still target it.
     */
    except?: "core-stratagems";
    weapon_type?: "melee" | "ranged";
    weapon_name?: string;
    weapon_keyword?: string;
    weapon_ref?:
      | {
          weapon_var: string;
        }
      | {
          selected_by: {
            ability: EntityId;
          };
        };
  };
  scaling?: Scaling;
}
/**
 * [permission] The target counts as being within a range of something, or inside a region.
 */
export interface CountsAsEffect {
  type: "counts-as";
  target: UnitRef;
  modifier: {
    [k: string]: unknown;
  };
  scaling?: Scaling;
}
/**
 * [permission] Switch a named rule on or off for the target.
 */
export interface RuleStateEffect {
  type: "rule-state";
  target: UnitRef;
  modifier: {
    direction: "granted" | "suppressed";
    rule_kind: "core-rule" | "keyword" | "ability" | "faction-rule";
    rule: string;
  };
  scaling?: Scaling;
}
/**
 * [protection] The target suffers mortal wounds: a count, or a count per success on a roll per model.
 */
export interface MortalWoundsEffect {
  type: "mortal-wounds";
  target: UnitRef;
  modifier: {
    count: Quantity;
    per?: "model" | "success";
    roll?: {
      dice: number | string;
      threshold: number;
      per_model?: "target" | "this";
    };
    range?: RangeRef;
    psychic?: true;
  };
  scaling?: Scaling;
}
/**
 * [protection] Reduce the Damage of attacks allocated to the target.
 */
export interface DamageReductionEffect {
  type: "damage-reduction";
  target: UnitRef;
  modifier: {
    reduction: number | ("half" | "to-zero");
    weapon_type?: "melee" | "ranged";
    weapon_name?: string;
    weapon_keyword?: string;
    weapon_ref?:
      | {
          weapon_var: string;
        }
      | {
          selected_by: {
            ability: EntityId;
          };
        };
  };
  scaling?: Scaling;
}
/**
 * [protection] The target has a Feel No Pain save.
 */
export interface FeelNoPainEffect {
  type: "feel-no-pain";
  target: UnitRef;
  modifier: {
    threshold: number | UnitRating;
    against?: "all" | "mortal" | "psychic" | "psychic-and-mortal";
  };
  scaling?: Scaling;
}
/**
 * [protection] The target has an invulnerable save of at least this.
 */
export interface InvulnerableSaveEffect {
  type: "invulnerable-save";
  target: UnitRef;
  modifier: {
    invuln_sv: number;
    weapon_type?: "melee" | "ranged";
    weapon_name?: string;
    weapon_keyword?: string;
    weapon_ref?:
      | {
          weapon_var: string;
        }
      | {
          selected_by: {
            ability: EntityId;
          };
        };
  };
  scaling?: Scaling;
}
/**
 * [models] Models in the target regain lost wounds.
 */
export interface HealEffect {
  type: "heal";
  target: UnitRef;
  modifier: {
    amount: Quantity | "full";
    per?: "model" | "unit";
  };
  scaling?: Scaling;
}
/**
 * [models] Return destroyed models to the target unit. bodyguard_only: only Bodyguard models; exclude_model_keyword: models with these keywords do not return; detach: the returned model is set up as its own unit (leaving the attached unit) with Starting Strength starting_strength.
 */
export interface ReturnModelsEffect {
  type: "return-models";
  target: UnitRef;
  modifier: {
    count: Quantity | "all";
    wounds_remaining?: Quantity | "full";
    placement?:
      | (
          | "closest-to-destruction"
          | "closest-to-original"
          | "coherency"
          | "unengaged"
          | "wholly-within"
          | "within"
          | "strategic-reserves"
          | "anywhere"
          | "connected-sections"
          | "deployment-zone"
          | "on-terrain"
        )
      | [
          (
            | "closest-to-destruction"
            | "closest-to-original"
            | "coherency"
            | "unengaged"
            | "wholly-within"
            | "within"
            | "strategic-reserves"
            | "anywhere"
            | "connected-sections"
            | "deployment-zone"
            | "on-terrain"
          ),
          ...(
            | "closest-to-destruction"
            | "closest-to-original"
            | "coherency"
            | "unengaged"
            | "wholly-within"
            | "within"
            | "strategic-reserves"
            | "anywhere"
            | "connected-sections"
            | "deployment-zone"
            | "on-terrain"
          )[]
        ];
    range?: RangeRef;
    model_keyword?: string;
    exclude_model_keyword?: KeywordList;
    bodyguard_only?: true;
    detach?: true;
    starting_strength?: number;
    /**
     * @minItems 1
     */
    near?: [PlacementNear, ...PlacementNear[]];
    /**
     * @minItems 1
     */
    away_from?: [PlacementAway, ...PlacementAway[]];
    in_region?: PlacementRegion;
  };
  scaling?: Scaling;
}
/**
 * [models] Destroy models in the target.
 */
export interface DestroyModelsEffect {
  type: "destroy-models";
  target: UnitRef;
  modifier: {
    count: Quantity | "all";
    model_keyword?: string;
    remove_from_play?: true;
    ignore_death_triggers?: true;
    exclude_leader?: true;
  };
  scaling?: Scaling;
}
/**
 * [models] A destroyed model can fight or shoot before it is removed.
 */
export interface ActOnDeathEffect {
  type: "act-on-death";
  target: UnitRef;
  modifier: {
    act: "fight" | "shoot";
    resolution?: string;
    removal?: string;
    gate?: {
      [k: string]: unknown;
    };
    eligibility?: AbilityDSLCondition2;
  };
  scaling?: Scaling;
}
/**
 * [models] Split the target unit: into units of these sizes, one unit per model, or one unit per listed model keyword.
 */
export interface SplitUnitEffect {
  type: "split-unit";
  target: UnitRef;
  modifier: {
    [k: string]: unknown;
  };
  scaling?: Scaling;
}
/**
 * [models] Add a unit to your army: a copy of a destroyed unit, or a named datasheet, with model_count models and Starting Strength starting_strength; join: the new models join that unit instead of forming a new one.
 */
export interface AddUnitEffect {
  type: "add-unit";
  target: UnitRef;
  modifier: {
    [k: string]: unknown;
  };
  scaling?: Scaling;
}
/**
 * [models] The target unit counts as destroyed only once another model or unit is also destroyed.
 */
export interface DestructionRuleEffect {
  type: "destruction-rule";
  target: UnitRef;
  modifier: {
    also: UnitRef;
  };
  scaling?: Scaling;
}
/**
 * [move] The target makes a move now. A surge move carries its core limit (21.02).
 */
export interface MoveEffect {
  type: "move";
  target: UnitRef;
  modifier: {
    move_type:
      | "normal"
      | "advance"
      | "fall-back"
      | "charge"
      | "pile-in"
      | "consolidation"
      | "surge"
      | "scout"
      | "ingress"
      | "disembark"
      | "embark"
      | "pulse-jet";
    distance?: Quantity;
    /**
     * @minItems 1
     */
    passthrough?: [
      (
        | (
            | "all-terrain"
            | "models"
            | "non-titanic-models"
            | "terrain-le-4"
            | "tall-terrain"
            | "friendly-vehicles"
            | "friendly-monsters"
            | "terrain"
            | "models-excluding-monster-vehicle"
            | "models-excluding-titanic"
            | "enemy-models-excluding-monster-vehicle"
            | "enemy-models"
          )
        | {
            kind: "models" | "terrain";
            owner?: Owner;
            all_of?: KeywordList;
            excluding?: KeywordList;
            height?: "up-to-4" | "over-4";
          }
      ),
      ...(
        | (
            | "all-terrain"
            | "models"
            | "non-titanic-models"
            | "terrain-le-4"
            | "tall-terrain"
            | "friendly-vehicles"
            | "friendly-monsters"
            | "terrain"
            | "models-excluding-monster-vehicle"
            | "models-excluding-titanic"
            | "enemy-models-excluding-monster-vehicle"
            | "enemy-models"
          )
        | {
            kind: "models" | "terrain";
            owner?: Owner;
            all_of?: KeywordList;
            excluding?: KeywordList;
            height?: "up-to-4" | "over-4";
          }
      )[]
    ];
    mode?: MoveMode;
    allow_engagement?: true;
    /**
     * The move counts as this kind of move for rules that check what the unit did this turn.
     */
    counts_as_move?:
      | "normal"
      | "advance"
      | "fall-back"
      | "charge"
      | "pile-in"
      | "consolidation"
      | "surge"
      | "scout"
      | "ingress"
      | "disembark"
      | "embark"
      | "pulse-jet"
      | "remain-stationary";
    ends_within?: {
      range: RangeRef;
      of?: PlaceRef;
      wholly?: true;
    };
    ends_when?: AbilityDSLCondition5;
    keeps_eligible?: true;
  };
  scaling?: Scaling;
}
/**
 * [move] Change how the target's moves work.
 */
export interface MoveModifierEffect {
  type: "move-modifier";
  target: UnitRef;
  modifier: {
    /**
     * @minItems 1
     */
    applies_to_moves?: [
      (
        | "normal"
        | "advance"
        | "fall-back"
        | "charge"
        | "pile-in"
        | "consolidation"
        | "surge"
        | "scout"
        | "ingress"
        | "disembark"
        | "embark"
        | "pulse-jet"
      ),
      ...(
        | "normal"
        | "advance"
        | "fall-back"
        | "charge"
        | "pile-in"
        | "consolidation"
        | "surge"
        | "scout"
        | "ingress"
        | "disembark"
        | "embark"
        | "pulse-jet"
      )[]
    ];
    /**
     * @minItems 1
     */
    passthrough?: [
      (
        | (
            | "all-terrain"
            | "models"
            | "non-titanic-models"
            | "terrain-le-4"
            | "tall-terrain"
            | "friendly-vehicles"
            | "friendly-monsters"
            | "terrain"
            | "models-excluding-monster-vehicle"
            | "models-excluding-titanic"
            | "enemy-models-excluding-monster-vehicle"
            | "enemy-models"
          )
        | {
            kind: "models" | "terrain";
            owner?: Owner;
            all_of?: KeywordList;
            excluding?: KeywordList;
            height?: "up-to-4" | "over-4";
          }
      ),
      ...(
        | (
            | "all-terrain"
            | "models"
            | "non-titanic-models"
            | "terrain-le-4"
            | "tall-terrain"
            | "friendly-vehicles"
            | "friendly-monsters"
            | "terrain"
            | "models-excluding-monster-vehicle"
            | "models-excluding-titanic"
            | "enemy-models-excluding-monster-vehicle"
            | "enemy-models"
          )
        | {
            kind: "models" | "terrain";
            owner?: Owner;
            all_of?: KeywordList;
            excluding?: KeywordList;
            height?: "up-to-4" | "over-4";
          }
      )[]
    ];
    ignore_vertical?: true;
    no_end_in_engagement?: true;
    distance_bonus?: number | string;
    advance?: "fixed-6";
    end_on_terrain?: true;
  };
  scaling?: Scaling;
}
/**
 * [placement] Set the target up: onto the battlefield or into Strategic Reserves, with the placement limits the rule prints. allow: false forbids that set-up instead. mandatory: it must be set up this way. arrives: it arrives in your next Movement phase (allow_first_round: even in the first battle round).
 */
export interface SetUpEffect {
  type: "set-up";
  target: UnitRef;
  modifier: {
    allow?: boolean;
    to: "battlefield" | "strategic-reserves";
    from?: "strategic-reserves" | "transport" | "battlefield";
    via?: "deep-strike";
    subject?: UnitRef | "models-on-this-model";
    min_enemy_distance?: number;
    within_edge?: number;
    /**
     * @minItems 1
     */
    turns?: [number, ...number[]];
    round_offset?: number;
    min_distance_from?: {
      of?: UnitRef;
      range: RangeRef;
    };
    placement?:
      | (
          | "closest-to-destruction"
          | "closest-to-original"
          | "coherency"
          | "unengaged"
          | "wholly-within"
          | "within"
          | "strategic-reserves"
          | "anywhere"
          | "connected-sections"
          | "deployment-zone"
          | "on-terrain"
        )
      | [
          (
            | "closest-to-destruction"
            | "closest-to-original"
            | "coherency"
            | "unengaged"
            | "wholly-within"
            | "within"
            | "strategic-reserves"
            | "anywhere"
            | "connected-sections"
            | "deployment-zone"
            | "on-terrain"
          ),
          ...(
            | "closest-to-destruction"
            | "closest-to-original"
            | "coherency"
            | "unengaged"
            | "wholly-within"
            | "within"
            | "strategic-reserves"
            | "anywhere"
            | "connected-sections"
            | "deployment-zone"
            | "on-terrain"
          )[]
        ];
    sections?: number;
    ignore_limits?: true;
    mode?: MoveMode;
    allow_engagement?: true;
    mandatory?: true;
    /**
     * Being set up this way counts as having made this move this turn.
     */
    counts_as_move?:
      | "normal"
      | "advance"
      | "fall-back"
      | "charge"
      | "pile-in"
      | "consolidation"
      | "surge"
      | "scout"
      | "ingress"
      | "disembark"
      | "embark"
      | "pulse-jet"
      | "remain-stationary";
    arrives?: "next-movement-phase";
    allow_first_round?: true;
    /**
     * @minItems 1
     */
    near?: [PlacementNear, ...PlacementNear[]];
    /**
     * @minItems 1
     */
    away_from?: [PlacementAway, ...PlacementAway[]];
    in_region?: PlacementRegion;
  };
  scaling?: Scaling;
}
/**
 * [placement] Place or relocate a marker.
 */
export interface MarkerEffect {
  type: "marker";
  target: UnitRef;
  modifier: {
    label: string;
    operation?: "place" | "relocate";
    placement?: string;
    distance?: number;
    consume?: "on-use" | "never";
  };
  scaling?: Scaling;
}
/**
 * [placement] How models count against a Transport's capacity: grouped models, fixed spaces per model, an equivalent model, or the Transport's own capacity with per-model spaces.
 */
export interface TransportCapacityEffect {
  type: "transport-capacity";
  target: UnitRef;
  modifier:
    | {
        occupancy_kind: "grouped-models";
        subject_kind: TransportOccupancySubjectKind;
        model_keyword?: string;
        transport_eligibility?: TransportEligibility;
        models_per_group: number;
        spaces_per_group: number;
        rounding: "up" | "down";
      }
    | {
        occupancy_kind: "fixed-model-spaces";
        subject_kind: TransportOccupancySubjectKind;
        model_keyword?: string;
        transport_eligibility?: TransportEligibility;
        spaces_per_model: number;
      }
    | {
        [k: string]: unknown;
      }
    | {
        capacity: number;
        eligible?: UnitFilter;
        /**
         * @minItems 1
         */
        space_per_model?: [
          {
            all_of?: KeywordList;
            any_of?: KeywordList;
            slots: number;
          },
          ...{
            all_of?: KeywordList;
            any_of?: KeywordList;
            slots: number;
          }[]
        ];
      };
  scaling?: Scaling;
}
/**
 * [test] Force the target to take a test (count or per: several rolls).
 */
export interface TestEffect {
  type: "test";
  target: UnitRef;
  modifier: {
    test: "battle-shock" | "leadership" | "hazard" | "desperate-escape";
    modifier?: number;
    count?: number;
    per?: string;
  };
  scaling?: Scaling;
}
/**
 * [test] Set or clear a state on the target.
 */
export interface StateChangeEffect {
  type: "state-change";
  target: UnitRef;
  modifier: {
    state: "battle-shocked";
    set: boolean;
  };
  scaling?: Scaling;
}
/**
 * [resource] Gain (or lose) CP.
 */
export interface CpGainEffect {
  type: "cp-gain";
  target: UnitRef;
  modifier: {
    amount: number;
  };
  scaling?: Scaling;
}
/**
 * [resource] Change what a Stratagem, manoeuvre or ability costs.
 */
export interface CostModifierEffect {
  type: "cost-modifier";
  target: UnitRef;
  modifier: {
    of: "stratagem" | "manoeuvre" | "ability";
    id?: EntityId;
    operation: "increase" | "decrease" | "set" | "multiply" | "waive";
    amount?: number;
    applies_to?: "targeting-this-unit" | "used-by-this-unit" | "the-triggering-use" | "any";
  };
  scaling?: Scaling;
}
/**
 * [resource] Add to a resource pool.
 */
export interface ResourceGainEffect {
  type: "resource-gain";
  target: UnitRef;
  modifier: {
    pool: string;
    amount: Quantity | ("variable" | "any");
    label?: string;
  };
  scaling?: Scaling;
}
/**
 * [resource] Spend from a resource pool. face: spend dice showing this value; requirement: spend dice forming this pair, triple or run.
 */
export interface ResourceSpendEffect {
  type: "resource-spend";
  target: UnitRef;
  modifier: {
    pool: string;
    amount: Quantity | ("all" | "one-or-more");
    label?: string;
    face?: number;
    requirement?: DiceRequirementSpec;
  };
  scaling?: Scaling;
}
/**
 * [resource] Add a die to a pool, or substitute a pooled die for a roll.
 */
export interface ResourceDieEffect {
  type: "resource-die";
  target: UnitRef;
  modifier: {
    pool: string;
    operation: "add" | "substitute";
    value?: number | ("rolled" | "highest");
    count?: Quantity;
    count_per_pool?: string;
    consumes_pool?: true;
    /**
     * @minItems 1
     */
    rolls?: [
      (
        | (
            | "hit"
            | "wound"
            | "save"
            | "damage"
            | "charge"
            | "advance"
            | "battle-shock"
            | "leadership"
            | "hazard"
            | "psychic"
            | "desperate-escape"
            | "deadly-demise"
            | "attacks"
            | "normal-move"
            | "surge"
            | "dark-pact"
            | "blessings-of-khorne"
            | "resource-die"
            | "manoeuvre"
            | "channelling"
            | "any"
            | "all"
          )
        | AbilityRoll
      ),
      ...(
        | (
            | "hit"
            | "wound"
            | "save"
            | "damage"
            | "charge"
            | "advance"
            | "battle-shock"
            | "leadership"
            | "hazard"
            | "psychic"
            | "desperate-escape"
            | "deadly-demise"
            | "attacks"
            | "normal-move"
            | "surge"
            | "dark-pact"
            | "blessings-of-khorne"
            | "resource-die"
            | "manoeuvre"
            | "channelling"
            | "any"
            | "all"
          )
        | AbilityRoll
      )[]
    ];
  };
  scaling?: Scaling;
}
/**
 * [designation] An objective the target controls stays under your control until the opponent's control is greater at the end of a phase.
 */
export interface ObjectiveStickyEffect {
  type: "objective-sticky";
  target: UnitRef;
  modifier?: {};
  scaling?: Scaling;
}
/**
 * [designation] Tag a unit, objective or terrain area (or clear the tag).
 */
export interface DesignateEffect {
  type: "designate";
  target: UnitRef;
  modifier: {
    subject?:
      | UnitRef
      | {
          objective: ObjectiveFilter;
        }
      | {
          terrain_area: {
            [k: string]: unknown;
          };
        };
    tag: DesignationId;
    clear?: true;
    /**
     * Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.
     */
    by?:
      | (
          | "this-unit"
          | "this-model"
          | "model-in-this-unit"
          | "attacker"
          | "defender"
          | "event-subject"
          | "event-object"
          | "stratagem-target"
          | "selected-unit"
          | "recipient"
          | "bearer-transport"
          | "ability-unit"
        )
      | UnitFilter
      | {
          event_var: string;
        }
      | {
          selection_var: string;
        }
      | {
          stratagem_target: EntityId;
        };
    clears_on?: ScopeDuration | ("turn-rollover" | "phase-end" | "never");
  };
  scaling?: Scaling;
}
/**
 * [army] A rule that applies when mustering the army.
 */
export interface ArmyRuleEffect {
  type: "army-rule";
  target: UnitRef;
  modifier: {
    rule:
      | "warlord-required"
      | "warlord-forbidden"
      | "unique"
      | "enhancement-forbidden"
      | "enhancement-slot"
      | "attachment"
      | "composition"
      | "faction-forbidden"
      | "single-chapter"
      | "detachment-forbidden"
      | "detachment-tag-exclusive";
    with?: UnitFilter;
    max?: number | BattleSizeValue;
    /**
     * What max counts (default units).
     */
    measure?: "units" | "models" | "points";
    per?: UnitFilter3;
    /**
     * @minItems 1
     */
    exempt_from?: ["retinue-limit", ..."retinue-limit"[]];
    attach_as?: UnitFilter4;
    detachment?: EntityId;
    tag?: string;
    led_by?: string;
    mandatory?: true;
    faction?: EntityId;
    enhancement_kind?: string;
  };
  scaling?: Scaling;
}
/**
 * Any unit (or model, with level: model) matching every listed property. Reads as 'a unit that…'.
 */
export interface UnitFilter3 {
  owner?: Owner;
  all_of?: KeywordList;
  any_of?: KeywordList;
  none_of?: KeywordList;
  /**
   * The unit carries this designation (a tag an effect applied).
   */
  designated?: string;
  state?: UnitState;
  /**
   * model: the filter matches individual models. Default unit.
   */
  level?: "unit" | "model";
  /**
   * Only units visible to the subject of the enclosing predicate.
   */
  visible?: true;
  /**
   * Only units within (wholly within, if set) this range of `of` (default the unit with the ability): aura recipients.
   */
  within?: {
    range: RangeRef;
    of?: UnitRef;
    wholly?: true;
  };
  /**
   * Not this unit ("another friendly unit").
   */
  excluding?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The designation was applied by this unit (their Spotted unit). Requires `designated`.
   */
  designated_by?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The unit does not carry this designation.
   */
  not_designated?: string;
  /**
   * Units embarked within this Transport.
   */
  embarked_in?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * Models (level: model) or units that are part of this unit, attached units included.
   */
  member_of?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  engaged_with?: UnitFilter1;
  not_engaged_with?: UnitFilter2;
  /**
   * Units with every listed ability.
   *
   * @minItems 1
   */
  has_ability?: [EntityId, ...EntityId[]];
  /**
   * Units with none of the listed abilities.
   *
   * @minItems 1
   */
  lacks_ability?: [EntityId, ...EntityId[]];
}
/**
 * Any unit (or model, with level: model) matching every listed property. Reads as 'a unit that…'.
 */
export interface UnitFilter4 {
  owner?: Owner;
  all_of?: KeywordList;
  any_of?: KeywordList;
  none_of?: KeywordList;
  /**
   * The unit carries this designation (a tag an effect applied).
   */
  designated?: string;
  state?: UnitState;
  /**
   * model: the filter matches individual models. Default unit.
   */
  level?: "unit" | "model";
  /**
   * Only units visible to the subject of the enclosing predicate.
   */
  visible?: true;
  /**
   * Only units within (wholly within, if set) this range of `of` (default the unit with the ability): aura recipients.
   */
  within?: {
    range: RangeRef;
    of?: UnitRef;
    wholly?: true;
  };
  /**
   * Not this unit ("another friendly unit").
   */
  excluding?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The designation was applied by this unit (their Spotted unit). Requires `designated`.
   */
  designated_by?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * The unit does not carry this designation.
   */
  not_designated?: string;
  /**
   * Units embarked within this Transport.
   */
  embarked_in?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  /**
   * Models (level: model) or units that are part of this unit, attached units included.
   */
  member_of?:
    | (
        | "this-unit"
        | "this-model"
        | "model-in-this-unit"
        | "attacker"
        | "defender"
        | "event-subject"
        | "event-object"
        | "stratagem-target"
        | "selected-unit"
        | "recipient"
        | "bearer-transport"
        | "ability-unit"
      )
    | UnitFilter
    | {
        event_var: string;
      }
    | {
        selection_var: string;
      }
    | {
        stratagem_target: EntityId;
      };
  engaged_with?: UnitFilter1;
  not_engaged_with?: UnitFilter2;
  /**
   * Units with every listed ability.
   *
   * @minItems 1
   */
  has_ability?: [EntityId, ...EntityId[]];
  /**
   * Units with none of the listed abilities.
   *
   * @minItems 1
   */
  lacks_ability?: [EntityId, ...EntityId[]];
}
/**
 * [test] The target does not need to take this test again within the window (no further Battle-shock tests this phase).
 */
export interface TestExemptionEffect {
  type: "test-exemption";
  target: UnitRef;
  modifier: {
    test: "battle-shock" | "leadership" | "desperate-escape";
    window: "phase" | "turn" | "battle-round";
  };
  scaling?: Scaling;
}
/**
 * [identity] The target unit uses another datasheet from now on (its profile, keywords and abilities), keeping its wounds and position.
 */
export interface DatasheetSwapEffect {
  type: "datasheet-swap";
  target: UnitRef;
  modifier: {
    datasheet: EntityId;
  };
  scaling?: Scaling;
}
/**
 * [characteristic] How a characteristic that differs between the target's models is resolved: the value most models have (ties: the higher or lower), or the highest or lowest. applies_to: only for that purpose.
 */
export interface CharacteristicResolutionEffect {
  type: "characteristic-resolution";
  target: UnitRef;
  modifier: {
    stat:
      | "M"
      | "T"
      | "Sv"
      | "W"
      | "Ld"
      | "OC"
      | "A"
      | "WS"
      | "BS"
      | "S"
      | "AP"
      | "D"
      | "Range"
      | "detection-range"
      | "psyker-level";
    rule: "majority" | "highest" | "lowest";
    tie?: "highest" | "lowest";
    applies_to?: "wound-roll" | "all";
    incoming?: true;
  };
  scaling?: Scaling;
}
/**
 * [ability] The target (a Transport) uses one ranged weapon from each of up to max_models models embarked within it (Firing Deck); those models cannot shoot.
 */
export interface BorrowWeaponsEffect {
  type: "borrow-weapons";
  target: UnitRef;
  modifier: {
    from?: UnitRef;
    max_models: Quantity;
    weapon_type?: "melee" | "ranged";
    exclude_weapon_keyword?: KeywordList;
    until?: ScopeDuration;
  };
  scaling?: Scaling;
}
/**
 * [ability] Pick one of the target's weapons (count of them) and bind it; weapon-qualified effects refer to it as weapon_ref {weapon_var}.
 */
export interface SelectWeaponEffect {
  type: "select-weapon";
  target: UnitRef;
  modifier: {
    count?: number;
    weapon_type?: "melee" | "ranged";
    weapon_keyword?: string;
    bind_as: string;
  };
  scaling?: Scaling;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "stratagem-target-restriction".
 */
export interface StratagemTargetRestriction {
  /**
   * Kebab-case identifier
   */
  name?: string;
  required_keywords?: KeywordList6;
  required_keywords_any?: KeywordList7;
  excluded_keywords?: KeywordList;
  /**
   * How many targets are selected: one, one or more, or up to `count_max`.
   */
  count?: "one" | "one-or-more" | "up-to";
  /**
   * Upper bound when `count` is up-to.
   */
  count_max?: number;
  /**
   * Whose units can be selected.
   */
  side?: "your-army" | "enemy";
  /**
   * Whether the target is a unit or a single model.
   */
  selects?: "unit" | "model";
  /**
   * The target is not freely chosen: it is the unit the WHEN moment names ("that unit"), or the unit the triggering enemy attacked.
   */
  bound_to?: "triggering-unit" | "attacked-unit";
  eligibility?: AbilityDSLCondition7;
  notes?: string;
}
/**
 * A CP-costed ability usable during specific game phases.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "stratagem".
 */
export interface Stratagem {
  id: EntityId;
  external_refs?: ExternalReferenceList;
  name: string;
  /**
   * Whether this is a universal core stratagem or tied to a specific detachment
   */
  category: "core" | "detachment";
  /**
   * GW-printed stratagem category from the card. Optional: 11e faction packs omit it for newly introduced detachments, and the category has no in-game effect; absent when the source does not state one.
   */
  type?: "battle-tactic" | "strategic-ploy" | "epic-deed" | "wargear";
  /**
   * Null for core stratagems
   */
  detachment_id?: EntityId | null;
  cp_cost: number;
  phases: PhaseList;
  player_turn: PlayerTurn;
  timing: "once-per-phase" | "once-per-turn" | "once-per-battle" | "unlimited";
  target_restrictions?:
    | StratagemTargetRestriction
    | [
        StratagemTargetRestriction & {
          [k: string]: unknown;
        },
        StratagemTargetRestriction & {
          [k: string]: unknown;
        },
        ...(StratagemTargetRestriction & {
          [k: string]: unknown;
        })[]
      ]
    | null;
  ability_id?: EntityId | null;
  game_version: GameVersionReference;
  game_modes?: GameModes3;
}
/**
 * A named target archetype for damage comparison. References a real dataset unit (faction_id + unit_id) rather than copying its stat line, so the profile stays in sync with dataset updates. Stats, keywords, and defensive abilities are resolved from the referenced unit at use time.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "target-profile".
 */
export interface TargetProfile {
  id: EntityId;
  name: string;
  description?: string;
  /**
   * Kebab-case identifier
   */
  faction_id: string;
  /**
   * Kebab-case identifier
   */
  unit_id: string;
  /**
   * Optional non-default squad size for the comparison. When null/absent, the referenced unit's model_count.min is used.
   */
  model_count_override?: number | null;
  game_version: GameVersionReference;
}
/**
 * One terrain piece placed on the board. Geometry comes from a catalog `template` or an inline `footprint` (if both are present, `footprint` is authoritative and `template` is provenance).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "piece".
 */
export interface Piece {
  /**
   * Kebab-case identifier
   */
  id?: string;
  name?: string;
  /**
   * An `area` is a gameplay zone with extent (an 11e 'terrain area' by default; set `terrain: false` for an EMPTY area such as a bare objective marker); a `feature` is physical scenery (walls, containers, pipes) placed on an area.
   */
  piece_type?: "area" | "feature";
  /**
   * Whether this area is gameplay terrain — an 11e terrain area that confers cover / area-terrain rules. `false` marks an EMPTY area: it still has a footprint (extent, for measurement and control-range display) but is not terrain and grants no cover, e.g. a 10th-edition objective marker sitting on open ground. Only meaningful for `area` pieces; absent means true (a terrain area). This is the data signal that distinguishes a 10th-style bare objective marker from an 11th objective embedded in a terrain area.
   */
  terrain?: boolean;
  /**
   * Kebab-case identifier
   */
  template?: string;
  /**
   * Inline geometry, standing in for or overriding a template footprint. Authoritative when present.
   */
  footprint?:
    | {
        type: "rectangle";
        width: number;
        height: number;
      }
    | {
        type: "right-triangle";
        width: number;
        height: number;
      }
    | {
        type: "polygon";
        /**
         * @minItems 3
         */
        points: [Vec2, Vec2, Vec2, ...Vec2[]];
      };
  position: Vec21;
  /**
   * Clockwise rotation about the centroid in the y-down board frame. Absent or 0 means the template's natural orientation.
   */
  rotation_degrees?: number;
  /**
   * Reflection applied in the centroid-local frame before rotation: `horizontal` negates local x (left-right flip), `vertical` negates local y.
   */
  mirror?: "none" | "horizontal" | "vertical";
  /**
   * Kebab-case identifier
   */
  parent_area_id?: string;
  /**
   * Ruin floor this piece occupies (0 = ground level).
   */
  floor?: number;
  /**
   * Height of the piece in inches; overrides the template default. Gates Plunging Fire (a piece 3" or taller confers +1 BS on ground-level targets).
   */
  height_inches?: number;
  /**
   * Terrain-area keywords this piece's area carries; overrides the template default.
   */
  terrain_area_keywords?: TerrainAreaKeyword[];
  /**
   * Pieces sharing a `link_group` value are linked terrain — treated as a single terrain feature (and, where an objective sits among them, a single objective).
   */
  link_group?: string;
  /**
   * Designates this terrain area — or, when `link_group`'d, the union of linked areas (one objective for the set) — as carrying an objective of the given 11e role: `home` (inside a deployment zone), `center` (board middle), or `expansion` (no-man's-land). Implies `is_objective`.
   */
  objective_role?: "home" | "expansion" | "center";
  /**
   * Whether this piece carries an objective marker.
   */
  is_objective?: boolean;
  /**
   * Objective-marker metadata. Only meaningful when `is_objective` is true.
   */
  objective?: {
    position?: Vec22;
    /**
     * Range from the marker within which models contribute to control.
     */
    control_range_inches?: number;
  };
  /**
   * Measurement keystones: the author-selected dimension lines a reference card prints so a player can place this piece with a tape measure (board edge → a feature of the placed piece). Only the selection is stored — the distance is always DERIVED from the resolved geometry by the shared keystone resolver (pinned by the conformance corpus), so a keystone can never disagree with the layout. Vertex indices follow the resolver's pinned vertex order; re-authoring a template's footprint invalidates them, so review keystones when geometry changes.
   */
  keystones?: {
    /**
     * The board edge the measurement runs from, in the y-down board frame (left/right pin x against board width; top/bottom pin y against board height).
     */
    edge: "left" | "right" | "top" | "bottom";
    /**
     * Which feature of the placed piece the measurement reaches: a footprint vertex (by resolver vertex order) or an axis-aligned bounding face of the placed footprint.
     */
    ref:
      | {
          kind: "vertex";
          index: number;
        }
      | {
          kind: "face";
          side: "min-x" | "max-x" | "min-y" | "max-y";
        };
  }[];
}
/**
 * A 2D point in board inches. Origin at a board corner; JSON uses y-down (downstream renderers may flip to y-up).
 */
export interface Vec21 {
  x: number;
  y: number;
}
/**
 * A 2D point in board inches. Origin at a board corner; JSON uses y-down (downstream renderers may flip to y-up).
 */
export interface Vec22 {
  x: number;
  y: number;
}
/**
 * A recommended arrangement of terrain pieces on the board, independent of the deployment map (a deployment-pattern references the layouts it recommends via recommended_terrain_layout_ids). Each piece draws its geometry from a catalog `template` (a terrain-template entity) or an inline `footprint`; geometry is the source of truth. Placement is template-centroid-anchored: `position` is the piece's centroid, which is invariant under rotation and mirror, so orientation and location are decoupled. Resolved board-space vertices are derived by the shared terrain resolver (pinned by the conformance corpus), never stored here. No layout data is authored yet beyond migrated examples.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "terrain-layout".
 */
export interface TerrainLayout {
  id: EntityId;
  name: string;
  /**
   * Mission pack or source the layout originates from.
   */
  source?: string;
  description?: string;
  /**
   * Kebab-case identifier
   */
  mission_matchup_id?: string;
  /**
   * The card's trailing variant number within its mission matchup (1–3 at launch, since three layouts share each pairing). No hard maximum, to avoid a breaking change if more variants ship.
   */
  variant?: number;
  /**
   * Kebab-case identifier
   */
  deployment_pattern_id?: string;
  /**
   * Board extents in inches (y-down). Absent means the 40kdc standard 60×44. A per-layout override for one-off boards (e.g. the 36×36 KOTC colosseum); resolver geometry is board-agnostic, so consumers use this only to size the table.
   */
  board?: {
    width: number;
    height: number;
  };
  /**
   * Terrain pieces composing the layout. May be empty while a layout is registered by name ahead of its confirmed geometry.
   */
  pieces?: Piece[];
  game_version: GameVersionReference;
}
/**
 * A feature placed on an area template, positioned in the area's centroid-local frame (y-down inches). When the area is placed, rotated, or mirrored, its composed features are carried along.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "composed-feature".
 */
export interface ComposedFeature {
  /**
   * Kebab-case identifier
   */
  id?: string;
  /**
   * Kebab-case identifier
   */
  template: string;
  position: Vec23;
  /**
   * Clockwise rotation of the feature about its own centroid, within the area-local frame.
   */
  rotation_degrees?: number;
  mirror?: "none" | "horizontal" | "vertical";
  /**
   * Ruin floor this feature occupies (0 = ground level).
   */
  floor?: number;
}
/**
 * A 2D point in board inches. Origin at a board corner; JSON uses y-down (downstream renderers may flip to y-up).
 */
export interface Vec23 {
  x: number;
  y: number;
}
/**
 * A reusable terrain piece in the standard catalog: a gameplay area (the 11e terrain-area templates) or a scenery feature (walls, containers, pipes, floor segments). Footprints are authored in natural local inches; the terrain resolver derives each footprint's polygon area centroid and re-centers on it, so a layout piece that instances a template places its centroid via the layout's `position`. An `area` template may carry an embedded `features` list — scenery placed in the area's centroid-local frame — making the template a reusable composition (e.g. a ruin with its walls). Placing such a template places all of its features, transformed by the area's own placement.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "terrain-template".
 */
export interface TerrainTemplate {
  id: EntityId;
  name: string;
  /**
   * `area` = a gameplay terrain zone; `feature` = physical scenery placed on an area.
   */
  kind: "area" | "feature";
  /**
   * Catalog or mission pack the template originates from.
   */
  source?: string;
  footprint: Footprint;
  /**
   * Default height in inches for pieces instancing this template. Gates Plunging Fire (>= 3").
   */
  default_height_inches?: number;
  /**
   * Whether the template blocks line of sight / movement by default.
   */
  default_blocking?: boolean;
  /**
   * Whether models may be placed on the ground footprint. `false` marks an elevated-only piece (a platform reachable only on its `upper_floor`, e.g. a gantry/catwalk) or a solid obstacle with no valid placement (e.g. a generator). Meaningful for `kind: "feature"`.
   */
  ground_accessible?: boolean;
  /**
   * An elevated platform carried by this feature (e.g. a ruin's second storey). Its footprint is authored in the SAME local frame as `footprint` and re-centered on the GROUND footprint's polygon area centroid, so the two floors stay registered when the piece is placed, rotated, or mirrored. Non-resolved metadata: the terrain resolver does not emit it; authoring/visualization tools render it as an overlay. Meaningful for `kind: "feature"`.
   */
  upper_floor?: {
    footprint: Footprint;
    /**
     * Ruin floor this platform occupies (1 = first floor above ground).
     */
    floor?: number;
  };
  /**
   * Terrain-area keywords areas of this template carry by default. Meaningful for `kind: "area"`.
   */
  default_terrain_area_keywords?: TerrainAreaKeyword[];
  /**
   * Composed scenery features, in the area's centroid-local frame. Only meaningful for `kind: "area"`.
   */
  features?: ComposedFeature[];
  /**
   * 11e terrain category (§13.02–13.05). Applies to kind: "feature". Dense features enable the Hidden rule; light features provide cover but not obscuring.
   */
  terrain_category?: "exposed" | "light" | "dense";
  /**
   * Wall polylines for this feature, in the same local frame as `footprint`. Meaningful for `kind: "feature"`.
   */
  walls?: Wall[];
  /**
   * Whether this feature has a roof. Meaningful for `kind: "feature"`.
   */
  has_roof?: boolean;
  /**
   * High-resolution boundary polygon for this template's base plate (the full die-cut nub outline). When present, rendering tools should prefer this over `footprint` for display; the resolver continues to use `footprint` for centroid and placement math. In the same local-inches frame as `footprint`.
   *
   * @minItems 3
   */
  outline?: [Vec2, Vec2, Vec2, ...Vec2[]];
  game_version: GameVersionReference;
}
/**
 * Describes the internal model-type breakdown of a unit.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "unit-composition".
 */
export interface UnitComposition {
  unit_id: EntityId;
  /**
   * Kebab-case identifier
   */
  faction_id: string;
  /**
   * @minItems 1
   */
  models: [
    {
      name: string;
      profile_name?: string | null;
      min: number;
      max: number;
      /**
       * The model's no-choice equipment multiset, used by base_loadout. It must describe a legal default configuration even when whole-model variants are present; it does not implicitly add another selectable variant.
       */
      default_weapon_ids?: EntityId[];
      is_leader_model?: boolean;
      base_size_mm?: BaseSize1;
      /**
       * Optional reference to a hull-shape entity giving this model's 2D collision polygon, used instead of the circular/oval base footprint. By convention a model carrying this should set `base_size_mm.shape` to "hull".
       */
      hull_shape_id?: EntityId | null;
      /**
       * Mutually exclusive whole-model loadout alternatives, expressed as named peers rather than deltas against default_weapon_ids. Each selected variant supplies one model's complete initial equipment multiset; repeated IDs preserve multiplicity. Compatible item-level wargear_options may transform that loadout but must satisfy the resulting variant's selection limits and all equipment budgets. When absent, models start with default_weapon_ids. When present, default_weapon_ids still governs base_loadout and is not replaced.
       *
       * @minItems 1
       */
      loadout_variants?: [
        {
          /**
           * The source peer's own model name (e.g. "Boy w/ Big shoota"). Unique within this model row.
           */
          name: string;
          /**
           * This variant's complete per-model equipment multiset. Every ID must be in the owning unit's weapon_ids or resolve to faction wargear. Repeated IDs mean multiple copies; an empty multiset is not a loadout.
           *
           * @minItems 1
           */
          weapon_ids: [EntityId, ...EntityId[]];
          /**
           * Ceiling on how many models of this row may take this variant, when the source states one on the variant itself. Shared and ratio-scaled ceilings live in `loadout_variant_budgets` instead.
           */
          max_count?: number;
        },
        ...{
          /**
           * The source peer's own model name (e.g. "Boy w/ Big shoota"). Unique within this model row.
           */
          name: string;
          /**
           * This variant's complete per-model equipment multiset. Every ID must be in the owning unit's weapon_ids or resolve to faction wargear. Repeated IDs mean multiple copies; an empty multiset is not a loadout.
           *
           * @minItems 1
           */
          weapon_ids: [EntityId, ...EntityId[]];
          /**
           * Ceiling on how many models of this row may take this variant, when the source states one on the variant itself. Shared and ratio-scaled ceilings live in `loadout_variant_budgets` instead.
           */
          max_count?: number;
        }[]
      ];
      /**
       * Caps over how many variant selections this model row may make, counting SELECTED VARIANTS rather than final weapon ids (two variants sharing a weapon must not charge each other's allowance). A singleton `variant_names` is an individual cap, several names a shared pool, and intersecting budgets a ratio plus a hard ceiling. The selected count across `variant_names` must not exceed `floor(scope_model_count * count / per_models)`, or simply `count` when `per_models` is 0.
       *
       * @minItems 1
       */
      loadout_variant_budgets?: [
        {
          /**
           * The `loadout_variants[].name` values sharing this allowance. Every name must exist in this same model row.
           *
           * @minItems 1
           */
          variant_names: [string, ...string[]];
          count: number;
          /**
           * Models required per `count` selections. 0 means the flat limit `count`, independent of squad size.
           */
          per_models: number;
          /**
           * Which model count scales the allowance: the whole unit, or just this model row.
           */
          scope: "unit" | "model-row";
        },
        ...{
          /**
           * The `loadout_variants[].name` values sharing this allowance. Every name must exist in this same model row.
           *
           * @minItems 1
           */
          variant_names: [string, ...string[]];
          count: number;
          /**
           * Models required per `count` selections. 0 means the flat limit `count`, independent of squad size.
           */
          per_models: number;
          /**
           * Which model count scales the allowance: the whole unit, or just this model row.
           */
          scope: "unit" | "model-row";
        }[]
      ];
    },
    ...{
      name: string;
      profile_name?: string | null;
      min: number;
      max: number;
      /**
       * The model's no-choice equipment multiset, used by base_loadout. It must describe a legal default configuration even when whole-model variants are present; it does not implicitly add another selectable variant.
       */
      default_weapon_ids?: EntityId[];
      is_leader_model?: boolean;
      base_size_mm?: BaseSize1;
      /**
       * Optional reference to a hull-shape entity giving this model's 2D collision polygon, used instead of the circular/oval base footprint. By convention a model carrying this should set `base_size_mm.shape` to "hull".
       */
      hull_shape_id?: EntityId | null;
      /**
       * Mutually exclusive whole-model loadout alternatives, expressed as named peers rather than deltas against default_weapon_ids. Each selected variant supplies one model's complete initial equipment multiset; repeated IDs preserve multiplicity. Compatible item-level wargear_options may transform that loadout but must satisfy the resulting variant's selection limits and all equipment budgets. When absent, models start with default_weapon_ids. When present, default_weapon_ids still governs base_loadout and is not replaced.
       *
       * @minItems 1
       */
      loadout_variants?: [
        {
          /**
           * The source peer's own model name (e.g. "Boy w/ Big shoota"). Unique within this model row.
           */
          name: string;
          /**
           * This variant's complete per-model equipment multiset. Every ID must be in the owning unit's weapon_ids or resolve to faction wargear. Repeated IDs mean multiple copies; an empty multiset is not a loadout.
           *
           * @minItems 1
           */
          weapon_ids: [EntityId, ...EntityId[]];
          /**
           * Ceiling on how many models of this row may take this variant, when the source states one on the variant itself. Shared and ratio-scaled ceilings live in `loadout_variant_budgets` instead.
           */
          max_count?: number;
        },
        ...{
          /**
           * The source peer's own model name (e.g. "Boy w/ Big shoota"). Unique within this model row.
           */
          name: string;
          /**
           * This variant's complete per-model equipment multiset. Every ID must be in the owning unit's weapon_ids or resolve to faction wargear. Repeated IDs mean multiple copies; an empty multiset is not a loadout.
           *
           * @minItems 1
           */
          weapon_ids: [EntityId, ...EntityId[]];
          /**
           * Ceiling on how many models of this row may take this variant, when the source states one on the variant itself. Shared and ratio-scaled ceilings live in `loadout_variant_budgets` instead.
           */
          max_count?: number;
        }[]
      ];
      /**
       * Caps over how many variant selections this model row may make, counting SELECTED VARIANTS rather than final weapon ids (two variants sharing a weapon must not charge each other's allowance). A singleton `variant_names` is an individual cap, several names a shared pool, and intersecting budgets a ratio plus a hard ceiling. The selected count across `variant_names` must not exceed `floor(scope_model_count * count / per_models)`, or simply `count` when `per_models` is 0.
       *
       * @minItems 1
       */
      loadout_variant_budgets?: [
        {
          /**
           * The `loadout_variants[].name` values sharing this allowance. Every name must exist in this same model row.
           *
           * @minItems 1
           */
          variant_names: [string, ...string[]];
          count: number;
          /**
           * Models required per `count` selections. 0 means the flat limit `count`, independent of squad size.
           */
          per_models: number;
          /**
           * Which model count scales the allowance: the whole unit, or just this model row.
           */
          scope: "unit" | "model-row";
        },
        ...{
          /**
           * The `loadout_variants[].name` values sharing this allowance. Every name must exist in this same model row.
           *
           * @minItems 1
           */
          variant_names: [string, ...string[]];
          count: number;
          /**
           * Models required per `count` selections. 0 means the flat limit `count`, independent of squad size.
           */
          per_models: number;
          /**
           * Which model count scales the allowance: the whole unit, or just this model row.
           */
          scope: "unit" | "model-row";
        }[]
      ];
    }[]
  ];
  /**
   * The discrete buildable squad sizes (GW's per-datasheet unit-composition rows). Each tier gives a per-model count range; a legal squad must match exactly one tier. When absent, the squad is treated as a single implicit tier equal to `models[]`. The top-level `models[]` min/max are the aggregate envelope (min-of-mins / max-of-maxes) across the tiers, so consumers that read only `models[]` still see the full range.
   *
   * @minItems 1
   */
  tiers?: [
    {
      /**
       * One entry per top-level `models[]` row, matched by `name`, giving this tier's count range for that model type.
       *
       * @minItems 1
       */
      models: [
        {
          name: string;
          min: number;
          max: number;
        },
        ...{
          name: string;
          min: number;
          max: number;
        }[]
      ];
    },
    ...{
      /**
       * One entry per top-level `models[]` row, matched by `name`, giving this tier's count range for that model type.
       *
       * @minItems 1
       */
      models: [
        {
          name: string;
          min: number;
          max: number;
        },
        ...{
          name: string;
          min: number;
          max: number;
        }[]
      ];
    }[]
  ];
  game_version: GameVersionReference;
  game_modes?: GameModes4;
}
/**
 * This model's base. Absent when no base could be resolved for the model.
 */
export interface BaseSize1 {
  shape: "round" | "oval" | "flying-base" | "hull" | "unique";
  diameter?: number;
  width?: number;
  length?: number;
  /**
   * Flying-base size class, when 'shape' is 'flying-base'.
   */
  size?: "small" | "large";
  /**
   * True when the entry is provisional/guessed (e.g. a category without authoritative dimensions) and should be revisited.
   */
  draft?: boolean;
}
/**
 * Catalog entry for a universal unit ability (a 'Core ability' in the rulebook: Deep Strike, Scouts X", Feel No Pain X+, Deadly Demise X, etc.). These are the unit-side counterpart of weapon-keyword.schema.json — community-authored mechanic labels, not reproduced rules text. A unit references a parameterised instance from its `ability_ids` (e.g. `scouts-6`); this catalog records the value-agnostic definition keyed by base id (e.g. `scouts`). The optional `effect` describes the mechanic in the Ability DSL; null when the behaviour is modelled per-faction in enrichment data rather than here.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "unit-keyword".
 */
export interface UnitKeyword {
  id: EntityId;
  name: string;
  /**
   * Parameter keys that must be supplied at each reference site (e.g. Scouts 6" → ['value']). Empty for abilities that take no number (Deep Strike, Infiltrators, Stealth).
   *
   * @maxItems 1
   */
  required_parameters: [] | ["value"];
  /**
   * Mechanical effect of this ability. Null when the behaviour is authored per-faction in the enrichment Ability DSL rather than centrally here — engines resolve the per-faction record.
   */
  effect: AbilityEffect1 | null;
  game_version: GameVersionReference;
}
/**
 * A unit datasheet entry with stat profiles and point costs.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "unit".
 */
export interface Unit {
  id: EntityId;
  external_refs?: ExternalReferenceList;
  name: string;
  /**
   * Alternate names this unit is known by (e.g. spelling variants in other tools' roster exports). Consulted by name lookup so an import matches despite a spelling difference; never displayed.
   */
  aliases?: string[];
  faction_id: EntityId;
  /**
   * Battlefield role from the datasheet header. Unit types (Infantry, Vehicle, etc.) belong in keywords.
   */
  role?: "character" | "battleline" | "dedicated-transport" | "fortification" | "allied" | "epic-hero";
  /**
   * Character attachment role (11e). 'support' implies the unit is only legal when attached to a host unit (cannot be taken solo); 'leader' is valid as a standalone list entry. null/absent for non-attaching units.
   */
  attachment_role?: ("leader" | "support") | null;
  /**
   * @minItems 1
   */
  profiles: [
    {
      /**
       * Profile name (e.g., 'Wounded' for degrading)
       */
      name?: string;
      M: StatValue;
      T: number;
      W: number;
      Sv: number;
      invuln_sv?: number | null;
      /**
       * Attack-scoped invulnerable save that applies only to ranged attacks.
       */
      invuln_sv_ranged?: number | null;
      /**
       * Attack-scoped invulnerable save that applies only to melee attacks.
       */
      invuln_sv_melee?: number | null;
      Ld: number;
      OC: number;
      [k: string]: unknown;
    },
    ...{
      /**
       * Profile name (e.g., 'Wounded' for degrading)
       */
      name?: string;
      M: StatValue;
      T: number;
      W: number;
      Sv: number;
      invuln_sv?: number | null;
      /**
       * Attack-scoped invulnerable save that applies only to ranged attacks.
       */
      invuln_sv_ranged?: number | null;
      /**
       * Attack-scoped invulnerable save that applies only to melee attacks.
       */
      invuln_sv_melee?: number | null;
      Ld: number;
      OC: number;
      [k: string]: unknown;
    }[]
  ];
  points?: {
    /**
     * Lowest model count this tier's cost applies to. For a single-size tier this is the only size; for a GW range-priced tier (block pricing) it is the range floor and `models_max` is the ceiling. `baseUnitPoints` prices a squad at the highest `models` threshold its count reaches.
     */
    models: number;
    cost: number;
    /**
     * Inclusive upper model count for a range-priced tier (GW block pricing, e.g. Venatari Custodians are 4–6 models for 320). `models` is the range floor; every size in [models, models_max] costs `cost`. Absent when the tier prices a single size (equivalent to models_max == models).
     */
    models_max?: number;
    /**
     * 11e per-army-ordinal pricing: the first army-copy count (1-based) this tier's cost applies to. Absent (together with unit_count_max) means the cost applies to every copy — the common case. Present only for datasheets the MFM prices by how many you have taken (e.g. 'your 1st-2nd units cost X, your 3rd+ unit costs Y').
     */
    unit_count_min?: number;
    /**
     * Inclusive upper army-copy count for this tier's band, or null for an open-ended top band ('3rd+ unit'). Absent when unit_count_min is absent.
     */
    unit_count_max?: number | null;
    [k: string]: unknown;
  }[];
  /**
   * 11e: alternate point costs that apply only when this unit is included in a host army of another faction (e.g. an Agents of the Imperium unit allied into any IMPERIUM army). Each entry mirrors a `points` tier but is scoped to a `host_faction`. Absent for the common case where the unit costs the same everywhere; consumers that don't model allied pricing read `points` (the native cost) and ignore this.
   */
  allied_points?: {
    /**
     * Kebab-case identifier
     */
    host_faction: string;
    models: number;
    cost: number;
    models_max?: number;
    unit_count_min?: number;
    unit_count_max?: number | null;
  }[];
  /**
   * True when point costs are carried over provisionally (e.g. seeded from a prior edition during migration) and not yet confirmed against the current dataslate.
   */
  points_provisional?: boolean;
  /**
   * Per-item MFM wargear prices that the option-level `additional_cost` on wargear-option records cannot express: priced default-loadout items (e.g. a Terminator Assault Squad's thunder hammers, which are the default with only a swap-away option to hang a cost on) and heterogeneous choice groups where only some items in a group cost points. Each entry charges `cost` points for every copy of `item_id` in the unit's FINAL loadout (defaults included). Additive and optional — a consumer that ignores it prices this wargear as free, exactly as before. Sourced authoritatively from the MFM dump (`wargear_option.points`).
   */
  wargear_costs?: {
    /**
     * Kebab-case identifier
     */
    item_id: string;
    /**
     * Points charged per copy of `item_id` present in the final loadout.
     */
    cost: number;
  }[];
  keywords?: KeywordList;
  faction_keywords?: KeywordList;
  /**
   * Keywords granted to this unit only when roster construction satisfies the source condition. Conditions are conjunctive within an entry; entries are independent grants.
   */
  conditional_keywords?: {
    keyword: Keyword;
    required_detachment_id?: EntityId | null;
    required_faction_keyword?: Keyword | null;
  }[];
  /**
   * Faction keywords whose armies are barred from taking this otherwise-generic unit. Used where the game removes a generic unit from a specific sub-faction without printing a replacement (e.g. Black Templars cannot field Librarians; Deathwatch cannot field the generic Tactical Squad). An army may take this unit only if none of its faction keywords appear here. Absent/empty = available to every keyword-eligible army. Distinct from `faction_keywords`, which is the positive access list; this is the negative one for the rare exclusions a flat shared pool cannot otherwise express.
   */
  excluded_faction_keywords?: KeywordList | null;
  /**
   * The unit's representative base (the most-numerous model's base). Mixed-model units carry the full per-model breakdown in unit-composition; this top-level value is a convenience for consumers that need a single base.
   */
  base_size_mm?: BaseSize | null;
  model_count?: {
    min: number;
    max: number;
    [k: string]: unknown;
  };
  weapon_ids?: EntityId[];
  /**
   * The abilities the unit's datasheet prints: an ability id, or an object for a rated rule ({id, value}: Deadly Demise D3, Feel No Pain 5+, Scouts 9", Firing Deck 2, whose record reads the value through {rating: true}) or for the ability a wargear item prints ({id, wargear}: the unit's default wargear that carries it).
   */
  ability_ids?: (EntityId | UnitAbilityRef)[];
  /**
   * Limited-wargear squad allowances the per-weapon bounds cannot express: a GW `limited_wargear_choice_set` that is either (a) SHARED across several weapons (a 'for every N models, one model can take one of A/B/C' line) or (b) a FLAT per-unit cap ('up to 1 per unit'). A loadout is legal only if the summed count of a budget's items is at most the cap: `floor(model_count * count / per_models)` for a ratio, or just `count` when `per_models` is 0 (a flat per-unit cap). Single-weapon per-N allowances are NOT budgets — the per-weapon bounds already model them (they correctly sum a weapon's capacity across the model types that may take it).
   */
  wargear_budgets?: {
    /**
     * @minItems 1
     */
    items: [EntityId, ...EntityId[]];
    count: number;
    /**
     * Models per `count` allowance; 0 means a flat per-unit cap of `count` (independent of squad size).
     */
    per_models: number;
    /**
     * Optional per-item sub-cap: at most this many copies of any SINGLE item in the set — `floor(model_count * duplicate_limit / per_models)` for a ratio, or `duplicate_limit` when `per_models` is 0. Absent means the shared `count` cap is the only bound (any one item may fill the whole allowance).
     */
    duplicate_limit?: number;
  }[];
  transport_capacity?: {
    capacity: number;
    keyword_restrictions?: KeywordList | null;
    exclusion_keywords?: KeywordList | null;
  } | null;
  game_version: GameVersionReference;
  is_legend?: boolean;
  game_modes?: GameModes5;
}
/**
 * An item-level weapon/wargear swap, addition, or choice available to models within a unit. An option transforms a model's default or selected whole-model loadout only when its model constraints and replacement prerequisites are satisfied. Whole-model alternatives belong in the composition's loadout_variants; applying an option must not bypass the resulting variant's selection limits or the unit's equipment budgets.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "wargear-option".
 */
export interface WargearOption {
  id: EntityId;
  unit_id: EntityId;
  /**
   * Kebab-case identifier
   */
  faction_id: string;
  model_constraint?: {
    model_name?: string;
    per_n_models?: number;
    max_count?: number;
    /**
     * When true, every model in the unit may take the option ('Any number of models can each ...'). Mutually exclusive in spirit with `per_n_models`.
     */
    any_number?: boolean;
  } | null;
  /**
   * Weapon or wargear IDs removed from the model. Omit for a pure add-on (the option only equips new wargear).
   *
   * @minItems 1
   */
  replaces?: [EntityId, ...EntityId[]];
  /**
   * Weapon or wargear IDs added to the model — all of them. Exactly one of `replacement` / `replacement_choice` is present.
   *
   * @minItems 1
   */
  replacement?: [EntityId, ...EntityId[]];
  /**
   * A choice of replacements ('one of the following'): pick exactly one inner group; each group's IDs are all added together. Exactly one of `replacement` / `replacement_choice` is present.
   *
   * @minItems 2
   */
  replacement_choice?: [[EntityId, ...EntityId[]], [EntityId, ...EntityId[]], ...[EntityId, ...EntityId[]][]];
  is_free?: boolean;
  additional_cost?: number | null;
  game_version: GameVersionReference;
  game_modes?: GameModes6;
}
/**
 * A non-weapon item a model may carry — an icon, attachment, or other piece of equipment with no weapon profile. Weapons live in weapon.schema.json; this entity exists so wargear-option swaps and add-ons can reference equipment that is not a weapon.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "wargear".
 */
export interface Wargear {
  id: EntityId;
  external_refs?: ExternalReferenceList;
  name: string;
  category?: string | null;
  game_version: GameVersionReference;
}
/**
 * Catalog entry for a weapon keyword (Lethal Hits, Sustained Hits N, Anti-X N+, etc.). Each weapon profile references entries here via {keyword_id, parameters?} instead of carrying free-text strings. The optional `effect` describes the keyword's game mechanic in the Ability DSL; null when the behaviour is faction-specific flavour not yet modelled.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "weapon-keyword".
 */
export interface WeaponKeyword {
  id: EntityId;
  name: string;
  /**
   * Parameter keys that must be supplied at each reference site, in the order they would appear in a printed datasheet (e.g. Anti-INFANTRY 4+ → ['target_keyword', 'threshold']).
   *
   * @maxItems 3
   */
  required_parameters:
    | []
    | ["value" | "target_keyword" | "threshold"]
    | ["value" | "target_keyword" | "threshold", "value" | "target_keyword" | "threshold"]
    | [
        "value" | "target_keyword" | "threshold",
        "value" | "target_keyword" | "threshold",
        "value" | "target_keyword" | "threshold"
      ];
  /**
   * Mechanical effect of this keyword. Null when the behaviour is faction-specific flavour not yet expressible in the DSL — engines treat such references as no-op buffs and may surface them as 'cannot auto-apply'.
   */
  effect: AbilityEffect1 | null;
  game_version: GameVersionReference;
}
/**
 * A weapon entry with one or more stat profiles (e.g., standard and overcharge modes).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "weapon".
 */
export interface Weapon {
  id: EntityId;
  external_refs?: ExternalReferenceList;
  name: string;
  type: "ranged" | "melee";
  /**
   * Kebab-case identifier
   */
  faction_id?: string;
  /**
   * @minItems 1
   */
  profiles: [
    {
      name: string;
      range?: number | "Melee";
      stats: {
        A: StatValue;
        BS?: number | null;
        WS?: number | null;
        S: StatValue;
        AP: number;
        D: StatValue;
        [k: string]: unknown;
      };
      /**
       * References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values (e.g. `Sustained Hits 1` → `{keyword_id: 'sustained-hits', parameters: {value: 1}}`).
       */
      keywords?: {
        keyword_id: EntityId;
        /**
         * Reference-site parameters conforming to the catalog entry's required parameters and optional target-keyword applicability gates.
         */
        parameters?: {
          value?: StatValue;
          target_keyword?: string;
          threshold?: number;
          required_target_keywords_any?: KeywordList8;
          excluded_target_keywords?: KeywordList9;
        };
      }[];
      /**
       * Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.
       */
      target_restrictions?: {
        required_keywords_any?: KeywordList10;
        excluded_keywords?: KeywordList11;
      } | null;
    },
    ...{
      name: string;
      range?: number | "Melee";
      stats: {
        A: StatValue;
        BS?: number | null;
        WS?: number | null;
        S: StatValue;
        AP: number;
        D: StatValue;
        [k: string]: unknown;
      };
      /**
       * References into the weapon-keyword catalog. Each entry names the catalog id and supplies parameter values (e.g. `Sustained Hits 1` → `{keyword_id: 'sustained-hits', parameters: {value: 1}}`).
       */
      keywords?: {
        keyword_id: EntityId;
        /**
         * Reference-site parameters conforming to the catalog entry's required parameters and optional target-keyword applicability gates.
         */
        parameters?: {
          value?: StatValue;
          target_keyword?: string;
          threshold?: number;
          required_target_keywords_any?: KeywordList8;
          excluded_target_keywords?: KeywordList9;
        };
      }[];
      /**
       * Target legality for this profile. Distinct from Anti and other effects that modify attacks after a legal target is selected.
       */
      target_restrictions?: {
        required_keywords_any?: KeywordList10;
        excluded_keywords?: KeywordList11;
      } | null;
    }[]
  ];
  game_version: GameVersionReference;
  game_modes?: GameModes7;
}
/**
 * Community-authored structured representation of what a game ability does. NOT GW text.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "ability".
 */
export interface AbilityDSLEntry {
  ability_id: EntityId;
  name: string;
  authored_by: ContributorRef;
  game_version: GameVersionReference;
  /**
   * SHA-256 of the NORMALISED printed rule this annotation was authored against — one-way, so the rule text itself stays outside this repository. Normalisation (defined once in tools/src/source-digest.ts) casefolds, folds Unicode, keeps the rule-significant operators + - = < > / % and replaces other punctuation with spaces, so reprint noise and quote style leave the digest unchanged while a changed value or an added condition changes it. Optional: absent means the source was never fingerprinted, which `npm run audit:source-digest` reports as untracked rather than current. Records source-content identity, not release history — consumers must not select, order or supersede abilities by it.
   */
  source_digest?: string;
  version?: DataslateVersion;
  /**
   * A seeded placeholder awaiting authoring: its effect is not the ability's mechanics. Removed when an authored effect replaces it.
   */
  stub?: true;
  supersedes?: DataslateVersion | null;
  unit_ids?: EntityId[];
  /**
   * Owning faction. Authored explicitly on faction/detachment-scoped abilities; otherwise stamped at bundle time from the ability's data/enrichment/<faction>/ directory (records in the shared _core pool stay null). Enables faction-scoped resolution of a unit's ability_ids so an ability_id shared across factions resolves to the unit's own faction's copy rather than whichever faction bundled first.
   */
  faction_id?: EntityId | null;
  /**
   * For detachment/enhancement/stratagem-type abilities, the associated detachment
   */
  detachment_id?: EntityId | null;
  ability_type?: "core" | "faction" | "detachment" | "unit" | "enhancement" | "stratagem";
  /**
   * How this ability interacts with the game flow — not a runtime predicate
   */
  behavior?: "passive" | "activated" | "reactive" | "aura";
  effect: AbilityEffect1;
  trigger?: AbilityTrigger;
  scope: AbilityScope;
  usage?: AbilityUsage;
  /**
   * Static, human-curated keyword filter naming which datasheet units this ability benefits, for roster-side highlighting. A unit matches when it carries every keyword in `required_keywords` (across its `keywords` + `faction_keywords`) and none in `excluded_keywords`. This is a denormalized projection distinct from the runtime `effect` condition tree (which mixes static class, runtime-granted markers, and timing gates and must not be scraped for scope). Absent/null means no resolvable unit scope — consumers render no highlight rather than guess.
   */
  applies_to?: {
    required_keywords?: KeywordList;
    excluded_keywords?: KeywordList;
  } | null;
  interactions?: {
    ability_ref: EntityId;
    type: "conflicts-with" | "combos-with" | "superseded-by" | "requires" | "replaces";
    notes?: string;
    [k: string]: unknown;
  }[];
  disputed?: boolean;
  dispute_notes?: string;
  community_notes?: string;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "scope".
 */
export interface AbilityScope {
  duration: ScopeDuration;
  [k: string]: unknown;
}
/**
 * A single reactive trigger: an event family (`event`), who acted (`subject`, default this-unit; clock events have none), what the action was aimed at (`object`), which one (`filter`: the move, roll, Stratagem or ability), a spatial gate (`proximity`), an extra gate (`condition`, where phase and turn go), `optional` for 'you can' reactions, a CP `cost`, and the `window` a granted reaction stays open.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "resource-action-menu-trigger".
 */
export interface Trigger1 {
  event: GameEvent;
  subject?: UnitRef;
  object?: UnitRef;
  filter?: EventFilter;
  /**
   * The event happened within range of `of` (default this-unit).
   */
  proximity?: {
    of?: UnitRef;
    range: RangeRef;
  };
  condition?: AbilityDSLCondition2;
  optional?: boolean;
  cost?: {
    cp?: number;
  };
  window?: string;
  binds_event_variable?: string;
  /**
   * Binds the generated Miracle die identity from a resource-generation trigger; consumers refer only as {die_var: ID}.
   */
  binds_die_variable?: string;
  /**
   * Binds the controller-selected Miracle die among those used in the triggering Act of Faith; consumers refer only as {die_var: ID}.
   */
  binds_selected_die_variable?: string;
  /**
   * The ability whose selection fired a `targets-selected {kind: ability}` trigger. Required there and allowed nowhere else.
   */
  source_ability?: {
    ability_id: EntityId;
    owner: "friendly" | "enemy";
    /**
     * All keywords required on the unit using the named source ability, not on the selected target.
     *
     * @minItems 1
     */
    keywords: [string, ...string[]];
  };
}
/**
 * A named state carried by a specific objective marker: the state resolves when its ability-level trigger fires, and may clear itself. Distinct from `objective-tag`, which only marks the objective without carrying a resolution.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "named-objective-state".
 */
export interface NamedObjectiveState {
  state_label: string;
  resolution: EffectNode;
  /**
   * When the named state is removed from the objective.
   */
  clears?: "after-resolving" | "end-of-turn" | "never";
}
/**
 * A marker placed on the battlefield that persists after placement: matching units may set up near it, using it may consume it, and enemy proximity removes it. Distinct from `tracking-token`, which is a reminder co-located with a model rather than a placed battlefield object with its own lifecycle.
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "persistent-battlefield-marker-state".
 */
export interface PersistentBattlefieldMarkerState {
  marker_label: string;
  /**
   * Where the marker is placed at the moment the ability resolves.
   */
  placement: "bearer" | "bearer-unit" | "battlefield";
  /**
   * Distance from the marker within which matching units may be set up.
   */
  setup_within_inches?: number;
  /**
   * When present, only units carrying every listed keyword may use the marker to set up; absent means any friendly unit.
   *
   * @minItems 1
   */
  setup_keywords?: [string, ...string[]];
  /**
   * Whether a single set-up use spends the marker.
   */
  consume?: "on-use" | "never";
  /**
   * Remove the marker once an enemy unit is within this distance of it.
   */
  removed_by_enemy_within_inches?: number;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "miracle-die-reference".
 */
export interface MiracleDieReference {
  die_var: string;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "interaction-flag".
 */
export interface InteractionFlag {
  ability_a: EntityId;
  ability_b: EntityId;
  interaction_type: "conflicts" | "combos" | "sequencing-dependent" | "stacks" | "does-not-stack" | "replaces";
  resolution?: string;
  faq_reference?: string;
  disputed?: boolean;
  game_version: GameVersionReference;
  authored_by?: ContributorRef;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "phase-mapping".
 */
export interface PhaseMapping {
  source_id: EntityId;
  source_type: SourceType;
  phases: PhaseList;
  game_version: GameVersionReference;
  authored_by?: ContributorRef;
  [k: string]: unknown;
}
/**
 * A faction's resource system (Miracle Dice, Pain tokens, Blessings dice pool, etc.).
 *
 * This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
 * via the `definition` "resource-pool".
 */
export interface ResourcePool {
  id: EntityId;
  name: string;
  faction_id: EntityId;
  pool_type: "token" | "dice-pool" | "counter";
  generation?: {
    condition: AbilityDSLCondition2;
    amount: StatValue;
    [k: string]: unknown;
  }[];
  max_size?: number | null;
  game_version: GameVersionReference;
}
