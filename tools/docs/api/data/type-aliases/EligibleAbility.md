[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EligibleAbility

# Type Alias: EligibleAbility

> **EligibleAbility** = `object`

Defined in: [abilities-resolver/resolver.ts:64](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/abilities-resolver/resolver.ts#L64)

## Properties

### ability

> **ability**: [`AbilityView`](../classes/AbilityView.md)

Defined in: [abilities-resolver/resolver.ts:65](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/abilities-resolver/resolver.ts#L65)

***

### source

> **source**: [`EligibleAbilitySource`](EligibleAbilitySource.md)

Defined in: [abilities-resolver/resolver.ts:66](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/abilities-resolver/resolver.ts#L66)

***

### phases

> **phases**: [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [abilities-resolver/resolver.ts:68](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/abilities-resolver/resolver.ts#L68)

The subset of `ability.phases` that intersect the requested phase.

***

### rating?

> `optional` **rating?**: `string` \| `number`

Defined in: [abilities-resolver/resolver.ts:70](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/abilities-resolver/resolver.ts#L70)

The rating the owning unit prints for a rated rule (Feel No Pain 5+ → 5).
