[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Stratagem

# Interface: Stratagem

Defined in: [generated.ts:6120](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6120)

A CP-costed ability usable during specific game phases.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "stratagem".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:6121](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6121)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:6122](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6122)

***

### name

> **name**: `string`

Defined in: [generated.ts:6123](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6123)

***

### category

> **category**: `"core"` \| `"detachment"`

Defined in: [generated.ts:6127](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6127)

Whether this is a universal core stratagem or tied to a specific detachment

***

### type?

> `optional` **type?**: `"battle-tactic"` \| `"strategic-ploy"` \| `"epic-deed"` \| `"wargear"`

Defined in: [generated.ts:6131](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6131)

GW-printed stratagem category from the card. Optional: 11e faction packs omit it for newly introduced detachments, and the category has no in-game effect; absent when the source does not state one.

***

### detachment\_id?

> `optional` **detachment\_id?**: `string` \| `null`

Defined in: [generated.ts:6135](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6135)

Null for core stratagems

***

### cp\_cost

> **cp\_cost**: `number`

Defined in: [generated.ts:6136](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6136)

***

### phases

> **phases**: [`PhaseList`](../type-aliases/PhaseList.md)

Defined in: [generated.ts:6137](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6137)

***

### player\_turn

> **player\_turn**: [`PlayerTurn`](../type-aliases/PlayerTurn.md)

Defined in: [generated.ts:6138](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6138)

***

### timing

> **timing**: `"once-per-turn"` \| `"once-per-phase"` \| `"unlimited"` \| `"once-per-battle"`

Defined in: [generated.ts:6139](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6139)

***

### target\_restrictions?

> `optional` **target\_restrictions?**: [`StratagemTargetRestriction`](StratagemTargetRestriction.md) \| \[[`StratagemTargetRestriction`](StratagemTargetRestriction.md) & `object`, [`StratagemTargetRestriction`](StratagemTargetRestriction.md) & `object`, `...(StratagemTargetRestriction & { [k: string]: unknown })[]`\] \| `null`

Defined in: [generated.ts:6140](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6140)

***

### ability\_id?

> `optional` **ability\_id?**: `string` \| `null`

Defined in: [generated.ts:6154](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6154)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:6155](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6155)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes3`](../type-aliases/GameModes3.md)

Defined in: [generated.ts:6156](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6156)
