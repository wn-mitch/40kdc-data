[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitFilter2

# Interface: UnitFilter2

Defined in: [generated.ts:6370](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6370)

Any unit (or model, with level: model) matching every listed property. Reads as 'a unit that…'.

## Properties

### owner?

> `optional` **owner?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:6371](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6371)

***

### all\_of?

> `optional` **all\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:6372](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6372)

***

### any\_of?

> `optional` **any\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:6373](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6373)

***

### none\_of?

> `optional` **none\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:6374](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6374)

***

### not\_all\_of?

> `optional` **not\_all\_of?**: [`KeywordList1`](../type-aliases/KeywordList1.md)

Defined in: [generated.ts:6375](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6375)

***

### shares\_any\_of?

> `optional` **shares\_any\_of?**: [`KeywordList2`](../type-aliases/KeywordList2.md)

Defined in: [generated.ts:6376](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6376)

***

### any\_of\_filters?

> `optional` **any\_of\_filters?**: \[[`UnitFilter`](UnitFilter.md), [`UnitFilter`](UnitFilter.md), `...UnitFilter[]`\]

Defined in: [generated.ts:6382](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6382)

Only units matching at least one of these filters, as well as every other listed property ("LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit"; "PSYKER or Battle-shocked unit"). Each alternative keeps its own keywords, exclusions and states; their keywords are never pooled into one requirement.

#### Min Items

2

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:6386](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6386)

The unit carries this designation (a tag an effect applied). warlord: the unit contains the Warlord model.

***

### state?

> `optional` **state?**: [`UnitState`](../type-aliases/UnitState.md)

Defined in: [generated.ts:6387](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6387)

***

### not\_states?

> `optional` **not\_states?**: \[[`UnitState`](../type-aliases/UnitState.md), `...UnitState[]`\]

Defined in: [generated.ts:6393](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6393)

Only units in none of these states ("unengaged", "not Battle-shocked").

#### Min Items

1

***

### level?

> `optional` **level?**: `"unit"` \| `"model"`

Defined in: [generated.ts:6397](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6397)

model: the filter matches individual models. Default unit.

***

### model\_names?

> `optional` **model\_names?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:6403](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6403)

Exact model-profile names; alternatives. This predicate applies only to individual models.

#### Min Items

1

***

### unit\_ids?

> `optional` **unit\_ids?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:6409](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6409)

Exact owning-faction unit identities; this predicate applies only to whole units.

#### Min Items

1

***

### attachment\_role?

> `optional` **attachment\_role?**: `"bodyguard"` \| `"leader"`

Defined in: [generated.ts:6413](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6413)

Actual attachment membership role, not a capability keyword.

***

### visible?

> `optional` **visible?**: `object`

Defined in: [generated.ts:6417](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6417)

Only units visible to the named observer.

#### to

> **to**: [`UnitRef`](../type-aliases/UnitRef.md)

***

### within?

> `optional` **within?**: `object`

Defined in: [generated.ts:6423](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6423)

Only units within (wholly within, if set) this range of `of` (default the unit with the ability): aura recipients.

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

#### of?

> `optional` **of?**: [`PlaceRef`](../type-aliases/PlaceRef.md)

#### wholly?

> `optional` **wholly?**: `true`

***

### excluding?

> `optional` **excluding?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:6431](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6431)

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

### designated\_by?

> `optional` **designated\_by?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:6463](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6463)

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

### not\_designated?

> `optional` **not\_designated?**: `string`

Defined in: [generated.ts:6495](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6495)

A designation (a tag an effect applies: spotted, observer, afflicted, riled-up). Kebab-case id; the describer prints the rules' term from its label table and integrity rejects ids outside the registry. Upper-case legacy spellings are accepted until the record repair normalises them. warlord is the list-building designation: the model chosen as Warlord when mustering. A unit carries it when it contains the Warlord model; a rule may test it but never apply it.

***

### embarked\_in?

> `optional` **embarked\_in?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:6499](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6499)

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

### member\_of?

> `optional` **member\_of?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:6531](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6531)

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

### engaged\_with?

> `optional` **engaged\_with?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:6563](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6563)

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

### not\_engaged\_with?

> `optional` **not\_engaged\_with?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:6595](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6595)

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

### has\_ability?

> `optional` **has\_ability?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:6629](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6629)

Units with every listed ability.

#### Min Items

1

***

### has\_ability\_models?

> `optional` **has\_ability\_models?**: `object`

Defined in: [generated.ts:6633](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6633)

has_ability holds when every model in the unit, except models with any keyword in none_of, has each listed ability ("every model (excluding CHARACTER models) in that unit has this ability"). Without it, has_ability reads the unit.

#### none\_of

> **none\_of**: [`KeywordList3`](../type-aliases/KeywordList3.md)

***

### lacks\_ability?

> `optional` **lacks\_ability?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:6641](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6641)

Units with none of the listed abilities.

#### Min Items

1
