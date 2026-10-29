[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitFilter

# Interface: UnitFilter

Defined in: [generated.ts:1277](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1277)

Any unit (or model, with level: model) matching every listed property. Reads as 'a unit that…'.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-filter".

## Properties

### owner?

> `optional` **owner?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:1278](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1278)

***

### all\_of?

> `optional` **all\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:1279](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1279)

***

### any\_of?

> `optional` **any\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:1280](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1280)

***

### none\_of?

> `optional` **none\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:1281](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1281)

***

### not\_all\_of?

> `optional` **not\_all\_of?**: [`KeywordList1`](../type-aliases/KeywordList1.md)

Defined in: [generated.ts:1282](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1282)

***

### any\_of\_filters?

> `optional` **any\_of\_filters?**: \[`UnitFilter`, `UnitFilter`, `...UnitFilter[]`\]

Defined in: [generated.ts:1288](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1288)

Only units matching at least one of these filters, as well as every other listed property ("LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit"; "PSYKER or Battle-shocked unit"). Each alternative keeps its own keywords, exclusions and states; their keywords are never pooled into one requirement.

#### Min Items

2

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:1292](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1292)

The unit carries this designation (a tag an effect applied). warlord: the unit contains the Warlord model.

***

### state?

> `optional` **state?**: [`UnitState`](../type-aliases/UnitState.md)

Defined in: [generated.ts:1293](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1293)

***

### not\_states?

> `optional` **not\_states?**: \[[`UnitState`](../type-aliases/UnitState.md), `...UnitState[]`\]

Defined in: [generated.ts:1299](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1299)

Only units in none of these states ("unengaged", "not Battle-shocked").

#### Min Items

1

***

### level?

> `optional` **level?**: `"unit"` \| `"model"`

Defined in: [generated.ts:1303](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1303)

model: the filter matches individual models. Default unit.

***

### model\_names?

> `optional` **model\_names?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1309](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1309)

Exact model-profile names; alternatives. This predicate applies only to individual models.

#### Min Items

1

***

### unit\_ids?

> `optional` **unit\_ids?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1315](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1315)

Exact owning-faction unit identities; this predicate applies only to whole units.

#### Min Items

1

***

### attachment\_role?

> `optional` **attachment\_role?**: `"bodyguard"` \| `"leader"`

Defined in: [generated.ts:1319](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1319)

Actual attachment membership role, not a capability keyword.

***

### visible?

> `optional` **visible?**: `object`

Defined in: [generated.ts:1323](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1323)

Only units visible to the named observer.

#### to

> **to**: [`UnitRef`](../type-aliases/UnitRef.md)

***

### within?

> `optional` **within?**: `object`

Defined in: [generated.ts:1329](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1329)

Only units within (wholly within, if set) this range of `of` (default the unit with the ability): aura recipients.

#### range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

#### of?

> `optional` **of?**: [`PlaceRef`](../type-aliases/PlaceRef.md)

#### wholly?

> `optional` **wholly?**: `true`

***

### excluding?

> `optional` **excluding?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| `UnitFilter` \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1337](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1337)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### designated\_by?

> `optional` **designated\_by?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| `UnitFilter` \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1365](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1365)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### not\_designated?

> `optional` **not\_designated?**: `string`

Defined in: [generated.ts:1393](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1393)

A designation (a tag an effect applies: spotted, observer, afflicted, riled-up). Kebab-case id; the describer prints the rules' term from its label table and integrity rejects ids outside the registry. Upper-case legacy spellings are accepted until the record repair normalises them. warlord is the list-building designation: the model chosen as Warlord when mustering. A unit carries it when it contains the Warlord model; a rule may test it but never apply it.

***

### embarked\_in?

> `optional` **embarked\_in?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| `UnitFilter` \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1397](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1397)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### member\_of?

> `optional` **member\_of?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| `UnitFilter` \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1425](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1425)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### engaged\_with?

> `optional` **engaged\_with?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| `UnitFilter` \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1453](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1453)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### not\_engaged\_with?

> `optional` **not\_engaged\_with?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| `UnitFilter` \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1481](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1481)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### has\_ability?

> `optional` **has\_ability?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1511](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1511)

Units with every listed ability.

#### Min Items

1

***

### lacks\_ability?

> `optional` **lacks\_ability?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1517](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1517)

Units with none of the listed abilities.

#### Min Items

1
