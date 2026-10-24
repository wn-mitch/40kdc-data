[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EventFilter

# Interface: EventFilter

Defined in: [generated.ts:1830](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1830)

Narrows an event family: which selection, move, roll or rule. Only the properties that make sense for the family are used.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "event-filter".

## Properties

### to?

> `optional` **to?**: `"disembark"` \| `"fight"` \| `"shoot"` \| `"declare-charge"` \| `"move"` \| `"attack"` \| `"observe"`

Defined in: [generated.ts:1834](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1834)

selected: what the unit was selected to do. attack means shoot or fight.

***

### kind?

> `optional` **kind?**: `"charge"` \| `"fight"` \| `"ability"` \| `"stratagem"` \| `"dark-pact"` \| `"manoeuvre"` \| `"shoot"` \| `"attack"` \| `"action"` \| `"order"` \| `"ritual"` \| `"act-of-faith"` \| `"doctrine"` \| `"contract"`

Defined in: [generated.ts:1838](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1838)

targets-selected / attacks-resolved / used: which kind of targeting, attack or rule.

***

### source?

> `optional` **source?**: \[`"enhancement"` \| `"unit"`, ...("enhancement" \| "unit")\[\]\]

Defined in: [generated.ts:1858](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1858)

used ability: which ability definitions the event may be a use of (unit is a datasheet ability; enhancement is an Enhancement ability).

#### Min Items

1

***

### usage?

> `optional` **usage?**: `object`

Defined in: [generated.ts:1862](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1862)

used ability: the exact once-per-battle cadence of the ability definition.

#### frequency

> **frequency**: `"n-per-battle"`

#### count

> **count**: `1`

***

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:1869](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1869)

Kebab-case identifier

***

### move\_types?

> `optional` **move\_types?**: \[`"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"`, ...("normal" \| "advance" \| "remain-stationary" \| "fall-back" \| "charge" \| "pile-in" \| "consolidation" \| "ingress" \| "surge" \| "scout" \| "disembark")\[\]\]

Defined in: [generated.ts:1873](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1873)

#### Min Items

1

***

### mode?

> `optional` **mode?**: `"desperate-escape"` \| `"ordered-retreat"` \| `"ongoing"` \| `"engaging"` \| `"objective"` \| `"rapid"` \| `"tactical"` \| `"combat"` \| `"emergency"` \| `"assault"`

Defined in: [generated.ts:1904](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1904)

A move type's named mode (a Fall Back's desperate escape, a combat disembark).

***

### roll?

> `optional` **roll?**: [`RollKind`](../type-aliases/RollKind.md)

Defined in: [generated.ts:1915](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1915)

***

### result?

> `optional` **result?**: [`RollOutcome`](../type-aliases/RollOutcome.md)

Defined in: [generated.ts:1916](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1916)

***

### from?

> `optional` **from?**: `"strategic-reserves"` \| `"deep-strike"` \| `"cult-ambush"` \| `"transport"`

Defined in: [generated.ts:1917](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1917)

***

### transport?

> `optional` **transport?**: `"this-unit"`

Defined in: [generated.ts:1921](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1921)

disembarked: the Transport the unit disembarked from; this-unit is "from this TRANSPORT".

***

### through?

> `optional` **through?**: `"terrain"` \| `"tall-terrain"`

Defined in: [generated.ts:1922](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1922)

***

### attack\_type?

> `optional` **attack\_type?**: `"psychic"` \| `"ranged"` \| `"melee"` \| `"mortal"`

Defined in: [generated.ts:1923](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1923)

***

### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

Defined in: [generated.ts:1924](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1924)

***

### by?

> `optional` **by?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Defined in: [generated.ts:1928](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1928)

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

***

### timing?

> `optional` **timing?**: `"before-removal"`

Defined in: [generated.ts:1956](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1956)

destroyed: resolve before the model is removed.

***

### first?

> `optional` **first?**: `true`

Defined in: [generated.ts:1960](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1960)

Only the first time this happens in the window.

***

### step?

> `optional` **step?**: `"battle-shock"` \| `"reinforcements"`

Defined in: [generated.ts:1961](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1961)

***

### state?

> `optional` **state?**: [`UnitState`](../type-aliases/UnitState.md)

Defined in: [generated.ts:1962](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1962)

***

### tag?

> `optional` **tag?**: `string`

Defined in: [generated.ts:1963](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1963)

***

### pool?

> `optional` **pool?**: `string`

Defined in: [generated.ts:1964](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1964)

***

### marker?

> `optional` **marker?**: `string`

Defined in: [generated.ts:1965](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1965)

***

### ability\_keyword?

> `optional` **ability\_keyword?**: `string`

Defined in: [generated.ts:1969](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1969)

used: any ability whose name carries this keyword in brackets (BONDSMAN for every '(Bondsman)' ability), instead of one `id`.

***

### same\_rule\_as?

> `optional` **same\_rule\_as?**: `object`

Defined in: [generated.ts:1973](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1973)

The exact ability or Stratagem definition used by the event a trigger bound with binds_event_variable; it is not a per-model instance or keyword-family match.

#### event\_var

> **event\_var**: `string`

***

### caused\_by?

> `optional` **caused\_by?**: [`EventBoundReference`](EventBoundReference.md)

Defined in: [generated.ts:1976](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1976)

***

### causes?

> `optional` **causes?**: [`EventBoundReference1`](EventBoundReference1.md)

Defined in: [generated.ts:1977](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1977)
