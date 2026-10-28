[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ReturnModelsEffect

# Interface: ReturnModelsEffect

Defined in: [generated.ts:5058](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5058)

[models] Return destroyed models to the target unit; model eligibility belongs to the typed target filter. detach: the returned model is set up as its own unit (leaving the attached unit) with Starting Strength starting_strength.

## Properties

### type

> **type**: `"return-models"`

Defined in: [generated.ts:5059](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5059)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5060](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5060)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5061](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5061)

#### count

> **count**: [`Quantity`](../type-aliases/Quantity.md)

#### wounds\_remaining?

> `optional` **wounds\_remaining?**: [`Quantity`](../type-aliases/Quantity.md)

Wounds the model has when it is set up: a number or dice expression, full (all of its wounds) or half-starting (half of its starting number of wounds).

#### placement?

> `optional` **placement?**: `"strategic-reserves"` \| `"cult-ambush"` \| `"within"` \| `"closest-to-destruction"` \| `"closest-to-original"` \| `"coherency"` \| `"unengaged"` \| `"wholly-within"` \| `"anywhere"` \| `"connected-sections"` \| `"deployment-zone"` \| `"on-terrain"` \| \[`"strategic-reserves"` \| `"cult-ambush"` \| `"within"` \| `"closest-to-destruction"` \| `"closest-to-original"` \| `"coherency"` \| `"unengaged"` \| `"wholly-within"` \| `"anywhere"` \| `"connected-sections"` \| `"deployment-zone"` \| `"on-terrain"`, ...("strategic-reserves" \| "cult-ambush" \| "within" \| "closest-to-destruction" \| "closest-to-original" \| "coherency" \| "unengaged" \| "wholly-within" \| "anywhere" \| "connected-sections" \| "deployment-zone" \| "on-terrain")\[\]\]

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### detach?

> `optional` **detach?**: `true`

#### starting\_strength?

> `optional` **starting\_strength?**: `number`

#### near?

> `optional` **near?**: \[[`PlacementNear`](PlacementNear.md), `...PlacementNear[]`\]

##### Min Items

1

#### away\_from?

> `optional` **away\_from?**: \[[`PlacementAway`](PlacementAway.md), `...PlacementAway[]`\]

##### Min Items

1

#### in\_region?

> `optional` **in\_region?**: [`PlacementRegion`](PlacementRegion.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5125](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5125)
