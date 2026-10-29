[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EventFilter

# Interface: EventFilter

Defined in: [generated.ts:2133](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2133)

Narrows an event family: which selection, move, roll or rule. Only the properties that make sense for the family are used.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "event-filter".

## Properties

### to?

> `optional` **to?**: `"disembark"` \| `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"move"` \| `"attack"` \| `"observe"`

Defined in: [generated.ts:2137](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2137)

selected: what the unit was selected to do. attack means shoot or fight.

***

### kind?

> `optional` **kind?**: `"charge"` \| `"fight"` \| `"ability"` \| `"stratagem"` \| `"dark-pact"` \| `"manoeuvre"` \| `"shoot"` \| `"attack"` \| `"action"` \| `"order"` \| `"ritual"` \| `"act-of-faith"` \| `"doctrine"` \| `"contract"`

Defined in: [generated.ts:2141](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2141)

targets-selected / attacks-resolved / used: which kind of targeting, attack or rule.

***

### source?

> `optional` **source?**: \[`"enhancement"` \| `"unit"`, ...("enhancement" \| "unit")\[\]\]

Defined in: [generated.ts:2161](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2161)

used ability: which ability definitions the event may be a use of (unit is a datasheet ability; enhancement is an Enhancement ability).

#### Min Items

1

***

### usage?

> `optional` **usage?**: `object`

Defined in: [generated.ts:2165](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2165)

used ability: the exact once-per-battle cadence of the ability definition.

#### frequency

> **frequency**: `"n-per-battle"`

#### count

> **count**: `1`

***

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:2172](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2172)

Kebab-case identifier

***

### move\_types?

> `optional` **move\_types?**: \[`"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"`, ...("normal" \| "advance" \| "remain-stationary" \| "fall-back" \| "charge" \| "pile-in" \| "consolidation" \| "ingress" \| "surge" \| "scout" \| "disembark")\[\]\]

Defined in: [generated.ts:2176](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2176)

#### Min Items

1

***

### mode?

> `optional` **mode?**: `"desperate-escape"` \| `"ordered-retreat"` \| `"ongoing"` \| `"engaging"` \| `"objective"` \| `"rapid"` \| `"tactical"` \| `"combat"` \| `"emergency"` \| `"assault"` \| `"shock"`

Defined in: [generated.ts:2207](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2207)

A move type's named mode (a Fall Back's desperate escape, a combat disembark).

***

### roll?

> `optional` **roll?**: [`RollKind`](../type-aliases/RollKind.md)

Defined in: [generated.ts:2219](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2219)

***

### result?

> `optional` **result?**: [`RollOutcome`](../type-aliases/RollOutcome.md)

Defined in: [generated.ts:2220](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2220)

***

### from?

> `optional` **from?**: `"strategic-reserves"` \| `"deep-strike"` \| `"cult-ambush"` \| `"transport"`

Defined in: [generated.ts:2221](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2221)

***

### transport?

> `optional` **transport?**: `"this-unit"`

Defined in: [generated.ts:2225](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2225)

disembarked: the Transport the unit disembarked from; this-unit is "from this TRANSPORT".

***

### through?

> `optional` **through?**: `"terrain"` \| `"tall-terrain"`

Defined in: [generated.ts:2226](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2226)

***

### attack\_type?

> `optional` **attack\_type?**: `"psychic"` \| `"ranged"` \| `"melee"` \| `"mortal"`

Defined in: [generated.ts:2227](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2227)

***

### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

Defined in: [generated.ts:2228](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2228)

***

### by?

> `optional` **by?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:2232](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2232)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### timing?

> `optional` **timing?**: `"before-removal"` \| `"after-attacks"`

Defined in: [generated.ts:2260](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2260)

destroyed: resolve before the model is removed (before-removal), or after the attacking unit has finished making its attacks (after-attacks).

***

### phase?

> `optional` **phase?**: `"charge"` \| `"command"` \| `"movement"` \| `"shooting"` \| `"fight"`

Defined in: [generated.ts:2264](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2264)

The five official game phases. Unchanged between 10th and 11th edition — 11e reorders Pile In timing within the Fight phase but adds no top-level phase.

***

### first?

> `optional` **first?**: `true`

Defined in: [generated.ts:2268](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2268)

Only the first time this happens in the window.

***

### step?

> `optional` **step?**: `"battle-shock"` \| `"reinforcements"`

Defined in: [generated.ts:2269](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2269)

***

### state?

> `optional` **state?**: [`UnitState`](../type-aliases/UnitState.md)

Defined in: [generated.ts:2270](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2270)

***

### tag?

> `optional` **tag?**: `string`

Defined in: [generated.ts:2271](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2271)

***

### pool?

> `optional` **pool?**: `string`

Defined in: [generated.ts:2272](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2272)

***

### marker?

> `optional` **marker?**: `string`

Defined in: [generated.ts:2273](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2273)

***

### ability\_keyword?

> `optional` **ability\_keyword?**: `string`

Defined in: [generated.ts:2277](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2277)

used: any ability whose name carries this keyword in brackets (BONDSMAN for every '(Bondsman)' ability), instead of one `id`.

***

### same\_rule\_as?

> `optional` **same\_rule\_as?**: `object`

Defined in: [generated.ts:2281](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2281)

The exact ability or Stratagem definition used by the event a trigger bound with binds_event_variable; it is not a per-model instance or keyword-family match.

#### event\_var

> **event\_var**: `string`

***

### caused\_by?

> `optional` **caused\_by?**: [`EventBoundReference`](EventBoundReference.md)

Defined in: [generated.ts:2284](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2284)

***

### causes?

> `optional` **causes?**: [`EventBoundReference1`](EventBoundReference1.md)

Defined in: [generated.ts:2285](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2285)
