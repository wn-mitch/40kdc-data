[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EventFilter

# Interface: EventFilter

Defined in: [generated.ts:975](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L975)

Narrows an event family: which selection, move, roll or rule. Only the properties that make sense for the family are used.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "event-filter".

## Properties

### to?

> `optional` **to?**: `"fight"` \| `"disembark"` \| `"move"` \| `"shoot"` \| `"attack"` \| `"observe"` \| `"declare-charge"`

Defined in: [generated.ts:979](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L979)

selected: what the unit was selected to do. attack means shoot or fight.

***

### kind?

> `optional` **kind?**: `"charge"` \| `"fight"` \| `"ability"` \| `"stratagem"` \| `"dark-pact"` \| `"shoot"` \| `"attack"` \| `"action"` \| `"manoeuvre"` \| `"order"` \| `"ritual"` \| `"act-of-faith"` \| `"doctrine"` \| `"contract"`

Defined in: [generated.ts:983](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L983)

targets-selected / attacks-resolved / used: which kind of targeting, attack or rule.

***

### id?

> `optional` **id?**: `string`

Defined in: [generated.ts:1001](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1001)

Kebab-case identifier

***

### move\_types?

> `optional` **move\_types?**: \[`"charge"` \| `"advance"` \| `"disembark"` \| `"fall-back"` \| `"normal"` \| `"remain-stationary"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"`, ...("charge" \| "advance" \| "disembark" \| "fall-back" \| "normal" \| "remain-stationary" \| "pile-in" \| "consolidation" \| "ingress" \| "surge" \| "scout")\[\]\]

Defined in: [generated.ts:1005](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1005)

#### Min Items

1

***

### mode?

> `optional` **mode?**: `"desperate-escape"` \| `"ordered-retreat"` \| `"ongoing"` \| `"engaging"` \| `"objective"` \| `"rapid"` \| `"tactical"` \| `"combat"` \| `"emergency"` \| `"assault"`

Defined in: [generated.ts:1036](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1036)

A move type's named mode (a Fall Back's desperate escape, a combat disembark).

***

### roll?

> `optional` **roll?**: [`RollKind`](../type-aliases/RollKind.md)

Defined in: [generated.ts:1047](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1047)

***

### result?

> `optional` **result?**: [`RollOutcome`](../type-aliases/RollOutcome.md)

Defined in: [generated.ts:1048](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1048)

***

### from?

> `optional` **from?**: `"deep-strike"` \| `"reserves"` \| `"strategic-reserves"` \| `"cult-ambush"` \| `"transport"`

Defined in: [generated.ts:1049](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1049)

***

### through?

> `optional` **through?**: `"terrain"` \| `"tall-terrain"`

Defined in: [generated.ts:1050](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1050)

***

### attack\_type?

> `optional` **attack\_type?**: `"psychic"` \| `"ranged"` \| `"melee"` \| `"mortal"`

Defined in: [generated.ts:1051](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1051)

***

### weapon\_name?

> `optional` **weapon\_name?**: `string`

Defined in: [generated.ts:1052](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1052)

***

### weapon\_keyword?

> `optional` **weapon\_keyword?**: `string`

Defined in: [generated.ts:1053](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1053)

***

### by?

> `optional` **by?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \}

Defined in: [generated.ts:1057](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1057)

Who caused it (the unit or model whose attack destroyed the object).

***

### timing?

> `optional` **timing?**: `"before-removal"`

Defined in: [generated.ts:1080](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1080)

destroyed: resolve before the model is removed.

***

### first?

> `optional` **first?**: `true`

Defined in: [generated.ts:1084](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1084)

Only the first time this happens in the window.

***

### step?

> `optional` **step?**: `"battle-shock"`

Defined in: [generated.ts:1085](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1085)

***

### state?

> `optional` **state?**: [`UnitState`](../type-aliases/UnitState.md)

Defined in: [generated.ts:1086](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1086)

***

### tag?

> `optional` **tag?**: `string`

Defined in: [generated.ts:1087](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1087)

***

### pool?

> `optional` **pool?**: `string`

Defined in: [generated.ts:1088](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1088)

***

### marker?

> `optional` **marker?**: `string`

Defined in: [generated.ts:1089](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1089)
