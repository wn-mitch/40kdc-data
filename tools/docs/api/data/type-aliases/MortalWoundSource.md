[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / MortalWoundSource

# Type Alias: MortalWoundSource

> **MortalWoundSource** = `object`

Defined in: [cruncher/mortal-sources.ts:18](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/mortal-sources.ts#L18)

Mortal wounds one ability inflicts on the target at one moment.

## Properties

### id

> **id**: `string`

Defined in: [cruncher/mortal-sources.ts:20](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/mortal-sources.ts#L20)

The ability id, then `?<option index>` for each enclosing `choice` option.

***

### moment

> **moment**: `string` \| `null`

Defined in: [cruncher/mortal-sources.ts:25](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/mortal-sources.ts#L25)

When they are inflicted: the trigger's event and its distinguishing filter value
(`move-ended:charge`, `phase-started:shooting`), or null for an ability with no trigger.

***

### expected

> **expected**: `number`

Defined in: [cruncher/mortal-sources.ts:30](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/mortal-sources.ts#L30)

Expected mortal wounds the target suffers each time the moment comes, before Feel No Pain,
when every condition in `needs` holds.

***

### needs

> **needs**: [`ConditionNeed`](ConditionNeed.md)[]

Defined in: [cruncher/mortal-sources.ts:32](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/mortal-sources.ts#L32)

Leaf conditions the context leaves undecided; answering one false removes the source.

***

### choices?

> `optional` **choices?**: [`MortalChoice`](MortalChoice.md)[]

Defined in: [cruncher/mortal-sources.ts:34](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/mortal-sources.ts#L34)

Each enclosing `choice`, outermost first, when there is one: picking this source picks its option.
