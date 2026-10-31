[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / UnsupportedFragment

# Type Alias: UnsupportedFragment

> **UnsupportedFragment** = `object`

Defined in: [cruncher/from-dsl.ts:56](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L56)

A fragment we couldn't translate. The SPA can render these as warnings.

## Properties

### reason

> **reason**: `string`

Defined in: [cruncher/from-dsl.ts:57](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L57)

***

### effectFragment

> **effectFragment**: `unknown`

Defined in: [cruncher/from-dsl.ts:58](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L58)

***

### needs?

> `optional` **needs?**: [`ConditionNeed`](ConditionNeed.md)[]

Defined in: [cruncher/from-dsl.ts:63](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L63)

For an undecided condition: the leaves that leave it undecided. Answering each in
[EngineContext.conditionFacts](EngineContext.md#conditionfacts) decides the condition.

***

### scope?

> `optional` **scope?**: [`UnsupportedScope`](UnsupportedScope.md)

Defined in: [cruncher/from-dsl.ts:68](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L68)

Whether the fragment could change the attack being crunched ([UnsupportedScope](UnsupportedScope.md)). Every
fragment [effectToBuffs](../functions/effectToBuffs.md) returns carries it.

***

### choice?

> `optional` **choice?**: `object`

Defined in: [cruncher/from-dsl.ts:73](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L73)

For a record grant inside a `choice` option: the lever that picks the option and the choice's
pool. The consumer that expands the grant keeps the granted record behind that pick.

#### lever

> **lever**: `string`

#### label

> **label**: `string`

#### group

> **group**: [`ActivatableGroupRef`](ActivatableGroupRef.md)
