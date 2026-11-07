[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EventFilter

# Interface: EventFilter

Defined in: [generated.ts:2233](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2233)

Narrows an event family: which selection, move, roll or rule. Only the properties that make sense for the family are used.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "event-filter".

## Properties

### to?

> `optional` **to?**: `"disembark"` \| `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"move"` \| `"attack"` \| `"observe"`

Defined in: [generated.ts:2237](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2237)

selected: what the unit was selected to do. attack means shoot or fight.

***

### kind?

> `optional` **kind?**: `"charge"` \| `"fight"` \| `"ability"` \| `"stratagem"` \| `"dark-pact"` \| `"manoeuvre"` \| `"shoot"` \| `"attack"` \| `"action"` \| `"order"` \| `"ritual"` \| `"act-of-faith"` \| `"doctrine"` \| `"contract"`

Defined in: [generated.ts:2241](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2241)

targets-selected / attacks-resolved / used: which kind of targeting, attack or rule.

***

### source?

> `optional` **source?**: \[`"enhancement"` \| `"unit"`, ...("enhancement" \| "unit")\[\]\]

Defined in: [generated.ts:2261](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2261)

used ability: which ability definitions the event may be a use of (unit is a datasheet ability; enhancement is an Enhancement ability).

#### Min Items

1

***

### usage?

> `optional` **usage?**: `object`

Defined in: [generated.ts:2265](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2265)

used ability: the exact once-per-battle cadence of the ability definition.

#### frequency

> **frequency**: `"n-per-battle"`

#### count

> **count**: `1`

***

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:2272](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2272)

Kebab-case identifier

***

### move\_types?

> `optional` **move\_types?**: \[`"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"`, ...("normal" \| "advance" \| "remain-stationary" \| "fall-back" \| "charge" \| "pile-in" \| "consolidation" \| "ingress" \| "surge" \| "scout" \| "disembark")\[\]\]

Defined in: [generated.ts:2276](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2276)

#### Min Items

1

***

### mode?

> `optional` **mode?**: `"desperate-escape"` \| `"ordered-retreat"` \| `"ongoing"` \| `"engaging"` \| `"objective"` \| `"rapid"` \| `"tactical"` \| `"combat"` \| `"emergency"` \| `"assault"` \| `"shock"`

Defined in: [generated.ts:2307](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2307)

A move type's named mode (a Fall Back's desperate escape, a combat disembark).

***

### roll?

> `optional` **roll?**: [`RollKind`](../type-aliases/RollKind.md)

Defined in: [generated.ts:2319](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2319)

***

### result?

> `optional` **result?**: [`RollOutcome`](../type-aliases/RollOutcome.md)

Defined in: [generated.ts:2320](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2320)

***

### unmodified?

> `optional` **unmodified?**: `object`

Defined in: [generated.ts:2324](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2324)

after-roll: only a die whose face, before any modifier, is from to to (inclusive).

#### from

> **from**: `number`

#### to

> **to**: `number`

***

### from?

> `optional` **from?**: `"strategic-reserves"` \| `"deep-strike"` \| `"cult-ambush"` \| `"transport"`

Defined in: [generated.ts:2328](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2328)

***

### transport?

> `optional` **transport?**: `"this-unit"` \| [`UnitFilter`](UnitFilter.md)

Defined in: [generated.ts:2332](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2332)

disembarked: the Transport the unit disembarked from; this-unit is "from this TRANSPORT", a unit filter the Transports it may be (a TRANSPORT within 6 inches of this model).

***

### through?

> `optional` **through?**: `"terrain"` \| `"tall-terrain"`

Defined in: [generated.ts:2333](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2333)

***

### attack\_type?

> `optional` **attack\_type?**: `"psychic"` \| `"ranged"` \| `"melee"` \| `"mortal"`

Defined in: [generated.ts:2334](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2334)

***

### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

Defined in: [generated.ts:2335](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2335)

***

### by?

> `optional` **by?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:2339](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2339)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

#### Union Members

`"this-unit"`

***

`"this-model"`

***

`"model-in-this-unit"`

***

`"attacker"`

***

`"defender"`

***

`"event-subject"`

***

`"event-object"`

***

`"stratagem-target"`

***

`"selected-unit"`

***

`"recipient"`

***

`"bearer-transport"`

***

`"ability-unit"`

***

[`UnitFilter`](UnitFilter.md)

***

##### Type Literal

\{ `event_var`: `string`; `role?`: `"object"`; \}

##### event\_var

> **event\_var**: `string`

##### role?

> `optional` **role?**: `"object"`

The bound event's object (the unit it was aimed at) instead of its actor.

***

##### Type Literal

\{ `selection_var`: `string`; \}

***

##### Type Literal

\{ `stratagem_target`: `string`; \}

***

### timing?

> `optional` **timing?**: `"before-removal"` \| `"after-attacks"` \| `"after-set-up"` \| `"after-emergency-disembark"`

Defined in: [generated.ts:2371](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2371)

destroyed: resolve before the model is removed (before-removal), after the attacking unit has finished making its attacks (after-attacks), or once the units embarked within the destroyed model have made their emergency disembark moves (after-emergency-disembark); disembarked: resolve once the unit has been set up (after-set-up).

***

### phase?

> `optional` **phase?**: `"charge"` \| `"command"` \| `"movement"` \| `"shooting"` \| `"fight"`

Defined in: [generated.ts:2375](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2375)

The five official game phases. Unchanged between 10th and 11th edition — 11e reorders Pile In timing within the Fight phase but adds no top-level phase.

***

### first?

> `optional` **first?**: `true`

Defined in: [generated.ts:2379](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2379)

Only the first time this happens in the window.

***

### step?

> `optional` **step?**: `"battle-shock"` \| `"reinforcements"`

Defined in: [generated.ts:2380](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2380)

***

### state?

> `optional` **state?**: [`UnitState`](../type-aliases/UnitState.md)

Defined in: [generated.ts:2381](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2381)

***

### tag?

> `optional` **tag?**: `string`

Defined in: [generated.ts:2382](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2382)

***

### pool?

> `optional` **pool?**: `string`

Defined in: [generated.ts:2383](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2383)

***

### marker?

> `optional` **marker?**: `string`

Defined in: [generated.ts:2384](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2384)

***

### ability\_keyword?

> `optional` **ability\_keyword?**: `string`

Defined in: [generated.ts:2388](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2388)

used: any ability whose name carries this keyword in brackets (BONDSMAN for every '(Bondsman)' ability), instead of one `id`.

***

### same\_rule\_as?

> `optional` **same\_rule\_as?**: `object`

Defined in: [generated.ts:2392](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2392)

The exact ability or Stratagem definition used by the event a trigger bound with binds_event_variable; it is not a per-model instance or keyword-family match.

#### event\_var

> **event\_var**: `string`

***

### caused\_by?

> `optional` **caused\_by?**: [`EventBoundReference`](EventBoundReference.md)

Defined in: [generated.ts:2395](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2395)

***

### causes?

> `optional` **causes?**: [`EventBoundReference1`](EventBoundReference1.md)

Defined in: [generated.ts:2396](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2396)
