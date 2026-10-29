[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / SetUpEffect

# Interface: SetUpEffect

Defined in: [generated.ts:5467](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5467)

[placement] Set the target up: onto the battlefield or into Strategic Reserves, with the placement limits the rule prints. allow: false forbids that set-up instead. mandatory: it must be set up this way. arrives: it arrives in your next Movement phase (allow_first_round: even in the first battle round). wounds_remaining: the wounds a model set (back) up has; detach: it is set up as its own unit, no longer part of its attached unit; starting_strength: the Starting Strength of the unit it is set up as.

## Properties

### type

> **type**: `"set-up"`

Defined in: [generated.ts:5468](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5468)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5469](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5469)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5470](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5470)

#### allow?

> `optional` **allow?**: `boolean`

#### to

> **to**: `"strategic-reserves"` \| `"battlefield"`

#### from?

> `optional` **from?**: `"strategic-reserves"` \| `"transport"` \| `"battlefield"`

#### via?

> `optional` **via?**: `"deep-strike"` \| `"cult-ambush"`

deep-strike: set up using the Deep Strike rules. cult-ambush: set up using a Cult Ambush marker (by default touching it, and the marker is then removed).

#### marker\_range?

> `optional` **marker\_range?**: `object`

##### marker\_range.range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

##### marker\_range.wholly?

> `optional` **wholly?**: `true`

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md) \| `"models-on-this-model"`

#### min\_enemy\_distance?

> `optional` **min\_enemy\_distance?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### within\_edge?

> `optional` **within\_edge?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### turns?

> `optional` **turns?**: \[`number`, `...number[]`\]

##### Min Items

1

#### round\_offset?

> `optional` **round\_offset?**: `number`

#### min\_distance\_from?

> `optional` **min\_distance\_from?**: `object`

##### min\_distance\_from.of?

> `optional` **of?**: [`UnitRef`](../type-aliases/UnitRef.md)

##### min\_distance\_from.range

> **range**: [`RangeRef`](../type-aliases/RangeRef.md)

#### placement?

> `optional` **placement?**: `"strategic-reserves"` \| `"cult-ambush"` \| `"within"` \| `"closest-to-destruction"` \| `"closest-to-original"` \| `"coherency"` \| `"unengaged"` \| `"wholly-within"` \| `"anywhere"` \| `"connected-sections"` \| `"deployment-zone"` \| `"on-terrain"` \| \[`"strategic-reserves"` \| `"cult-ambush"` \| `"within"` \| `"closest-to-destruction"` \| `"closest-to-original"` \| `"coherency"` \| `"unengaged"` \| `"wholly-within"` \| `"anywhere"` \| `"connected-sections"` \| `"deployment-zone"` \| `"on-terrain"`, ...("strategic-reserves" \| "cult-ambush" \| "within" \| "closest-to-destruction" \| "closest-to-original" \| "coherency" \| "unengaged" \| "wholly-within" \| "anywhere" \| "connected-sections" \| "deployment-zone" \| "on-terrain")\[\]\]

#### sections?

> `optional` **sections?**: `number`

#### ignore\_limits?

> `optional` **ignore\_limits?**: `true`

#### mode?

> `optional` **mode?**: [`MoveMode`](../type-aliases/MoveMode.md)

#### allow\_engagement?

> `optional` **allow\_engagement?**: `true`

#### mandatory?

> `optional` **mandatory?**: `true`

#### counts\_as\_move?

> `optional` **counts\_as\_move?**: `"normal"` \| `"advance"` \| `"remain-stationary"` \| `"fall-back"` \| `"charge"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"disembark"` \| `"embark"` \| `"pulse-jet"`

Being set up this way counts as having made this move this turn.

#### arrives?

> `optional` **arrives?**: `"next-movement-phase"`

#### allow\_first\_round?

> `optional` **allow\_first\_round?**: `true`

#### wounds\_remaining?

> `optional` **wounds\_remaining?**: [`Quantity`](../type-aliases/Quantity.md)

Wounds the model has when it is set up: a number or dice expression, full (all of its wounds) or half-starting (half of its starting number of wounds).

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

Defined in: [generated.ts:5579](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5579)
