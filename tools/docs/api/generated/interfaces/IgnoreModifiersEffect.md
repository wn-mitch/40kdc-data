[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / IgnoreModifiersEffect

# Interface: IgnoreModifiersEffect

Defined in: [generated.ts:3195](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3195)

[characteristic] Ignore modifiers to characteristics or rolls (all of them, or only worsening ones).

## Properties

### type

> **type**: `"ignore-modifiers"`

Defined in: [generated.ts:3196](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3196)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3197](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3197)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3198](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3198)

#### what

> **what**: `"characteristics"` \| `"rolls"`

#### stats?

> `optional` **stats?**: \[`"M"` \| `"T"` \| `"Sv"` \| `"W"` \| `"Ld"` \| `"OC"` \| `"A"` \| `"WS"` \| `"BS"` \| `"S"` \| `"AP"` \| `"D"` \| `"Range"` \| `"detection-range"` \| `"psyker-level"`, ...("M" \| "T" \| "Sv" \| "W" \| "Ld" \| "OC" \| "A" \| "WS" \| "BS" \| "S" \| "AP" \| "D" \| "Range" \| "detection-range" \| "psyker-level")\[\]\]

##### Min Items

1

#### rolls?

> `optional` **rolls?**: \[[`RollSelector`](../type-aliases/RollSelector.md), `...RollSelector[]`\]

##### Min Items

1

#### only?

> `optional` **only?**: `"worsening"` \| `"improving"`

#### incoming?

> `optional` **incoming?**: `true`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3247](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3247)
