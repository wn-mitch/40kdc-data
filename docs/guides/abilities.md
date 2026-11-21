# Working with Abilities, DSL, and Descriptions

`40kdc-data` stores unit abilities, detachment rules, enhancements, stratagems, and army rules as structured JSON trees (the Ability DSL) rather than reproduced rules text. A deterministic describer turns those trees into plain English, and the abilities resolver determines which rules apply to a given unit and phase.

## Reading a Unit's Abilities and Descriptions

Every `UnitView` exposes `.abilities`, and each `AbilityView` provides `.phases` (joined from phase mappings), `.describe()` (plain-English rendering), and `.raw` (the underlying DSL record):

```ts
import { units } from "@alpaca-software/40kdc-data";

const kharn = units.find("Kharn")!;

for (const ability of kharn.abilities) {
  console.log(ability.name, ability.phases);
  console.log(ability.describe());
}
```

To filter to abilities active in a specific game phase (`"command"`, `"movement"`, `"shooting"`, `"charge"`, `"fight"`):

```ts
const fightAbilities = kharn.abilities.filter(a => a.phases.includes("fight"));
```

## Rendering Standalone DSL Nodes

Use the translator functions directly when working with raw DSL objects (for example, in an editor or custom validator):

```ts
import {
  describeAbility,
  describeCondition,
  describeEffect,
  describeTrigger,
} from "@alpaca-software/40kdc-data";

const text = describeAbility({
  trigger: { event: "selected", filter: { to: "fight" } },
  scope: { duration: "phase" },
  effect: {
    type: "re-roll",
    target: "this-unit",
    modifier: { roll: "hit", subset: "ones" },
  },
});
// "When this unit is selected to fight, until the end of the phase, you can re-roll Hit rolls of 1."
```

## Resolving All Eligible Abilities for a Unit

A unit's datasheet abilities are only part of what applies on the tabletop — army rules, detachment rules, detachment stratagems, enhancements, attached leaders, and support units can all contribute. Use `dataset.eligibleAbilities` to collect everything eligible for a unit in a given phase:

```ts
import { dataset } from "@alpaca-software/40kdc-data";

const eligible = dataset.eligibleAbilities(
  {
    unitId: "intercessor-squad",
    factionId: "adeptus-astartes",
    detachmentId: "gladius-task-force",
    attachedLeaderIds: ["lieutenant"],
  },
  "shooting",
);

for (const { source, ability } of eligible) {
  console.log(`[${source.kind}] ${ability.name}: ${ability.describe()}`);
}
```

`source.kind` identifies where each rule came from (`"army"`, `"detachment"`, `"detachment-stratagem"`, `"unit"`, `"attached"`, or `"support"`).

## Checking Stratagem Targets and `applies_to` Filters

To test whether a detachment Stratagem can target a combined unit (accounting for attached leaders and keyword filters), or whether an ability's curated `applies_to` highlight matches a unit:

```ts
import {
  abilities,
  stratagems,
  stratagemCanTargetUnit,
  unitMatchesAppliesTo,
  units,
} from "@alpaca-software/40kdc-data";

const unit = units.find("Intercessor Squad")!;
const stratagem = stratagems.find("Armour of Contempt")!;

const canTarget = stratagemCanTargetUnit(stratagem.raw, [unit.raw]);

const ability = abilities.get("oath-of-moment")!;
const highlighted = unitMatchesAppliesTo(ability.raw.applies_to, unit.raw);
```

## Working with Game Modes

The default `dataset` is the **matched-play** view, which skips Combat Patrol-only records in listings and name searches. To query Combat Patrol abilities or inspect every mode at once:

```ts
import { dataset } from "@alpaca-software/40kdc-data";

const cp = dataset.forGameMode("combat-patrol");
const allModes = dataset.forGameMode("all");
```

Lookups by exact ID (`abilities.get(id)`) resolve across all modes in every view.
