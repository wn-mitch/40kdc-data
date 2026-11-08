[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitFilter3

# Interface: UnitFilter3

Defined in: [generated.ts:6646](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6646)

Any unit (or model, with level: model) matching every listed property. Reads as 'a unit that…'.

## Properties

### owner?

> `optional` **owner?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:6647](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6647)

***

### all\_of?

> `optional` **all\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:6648](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6648)

***

### any\_of?

> `optional` **any\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:6649](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6649)

***

### none\_of?

> `optional` **none\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:6650](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6650)

***

### not\_all\_of?

> `optional` **not\_all\_of?**: [`KeywordList1`](../type-aliases/KeywordList1.md)

Defined in: [generated.ts:6651](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6651)

***

### shares\_any\_of?

> `optional` **shares\_any\_of?**: [`KeywordList2`](../type-aliases/KeywordList2.md)

Defined in: [generated.ts:6652](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6652)

***

### any\_of\_filters?

> `optional` **any\_of\_filters?**: \[[`UnitFilter`](UnitFilter.md), [`UnitFilter`](UnitFilter.md), `...UnitFilter[]`\]

Defined in: [generated.ts:6658](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6658)

Only units matching at least one of these filters, as well as every other listed property ("LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit"; "PSYKER or Battle-shocked unit"). Each alternative keeps its own keywords, exclusions and states; their keywords are never pooled into one requirement.

#### Min Items

2

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:6662](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6662)

The unit carries this designation (a tag an effect applied). warlord: the unit contains the Warlord model.

***

### state?

> `optional` **state?**: [`UnitState`](../type-aliases/UnitState.md)

Defined in: [generated.ts:6663](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6663)

***

### not\_states?

> `optional` **not\_states?**: \[[`UnitState`](../type-aliases/UnitState.md), `...UnitState[]`\]

Defined in: [generated.ts:6669](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6669)

Only units in none of these states ("unengaged", "not Battle-shocked").

#### Min Items

1

***

### level?

> `optional` **level?**: `"unit"` \| `"model"`

Defined in: [generated.ts:6673](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6673)

model: the filter matches individual models. Default unit.

***

### model\_names?

> `optional` **model\_names?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:6679](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6679)

Exact model-profile names; alternatives. This predicate applies only to individual models.

#### Min Items

1

***

### unit\_ids?

> `optional` **unit\_ids?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:6685](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6685)

Exact owning-faction unit identities; this predicate applies only to whole units.

#### Min Items

1

***

### attachment\_role?

> `optional` **attachment\_role?**: `"bodyguard"` \| `"leader"`

Defined in: [generated.ts:6689](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6689)

Actual attachment membership role, not a capability keyword.

***

### visible?

> `optional` **visible?**: `object`

Defined in: [generated.ts:6693](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6693)

Only units visible to the named observer.

#### to

> **to**: [`UnitRef`](../type-aliases/UnitRef.md)

***

### within?

> `optional` **within?**: `object`

Defined in: [generated.ts:6699](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6699)

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

Defined in: [generated.ts:6707](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6707)

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

Defined in: [generated.ts:6739](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6739)

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

Defined in: [generated.ts:6771](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6771)

A designation (a tag an effect applies: spotted, observer, afflicted, riled-up). Kebab-case id; the describer prints the rules' term from its label table and integrity rejects ids outside the registry. Upper-case legacy spellings are accepted until the record repair normalises them. warlord is the list-building designation: the model chosen as Warlord when mustering. A unit carries it when it contains the Warlord model; a rule may test it but never apply it.

***

### embarked\_in?

> `optional` **embarked\_in?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; `role?`: `"object"`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:6775](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6775)

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

Defined in: [generated.ts:6807](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6807)

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

Defined in: [generated.ts:6839](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6839)

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

Defined in: [generated.ts:6871](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6871)

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

Defined in: [generated.ts:6905](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6905)

Units with every listed ability.

#### Min Items

1

***

### has\_ability\_models?

> `optional` **has\_ability\_models?**: `object`

Defined in: [generated.ts:6909](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6909)

has_ability holds when every model in the unit, except models with any keyword in none_of, has each listed ability ("every model (excluding CHARACTER models) in that unit has this ability"). Without it, has_ability reads the unit.

#### none\_of

> **none\_of**: [`KeywordList3`](../type-aliases/KeywordList3.md)

***

### lacks\_ability?

> `optional` **lacks\_ability?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:6917](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6917)

Units with none of the listed abilities.

#### Min Items

1
