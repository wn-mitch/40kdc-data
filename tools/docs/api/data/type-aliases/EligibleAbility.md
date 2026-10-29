[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EligibleAbility

# Type Alias: EligibleAbility

> **EligibleAbility** = `object`

Defined in: [abilities-resolver/resolver.ts:64](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L64)

## Properties

### ability

> **ability**: [`AbilityView`](../classes/AbilityView.md)

Defined in: [abilities-resolver/resolver.ts:65](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L65)

***

### source

> **source**: [`EligibleAbilitySource`](EligibleAbilitySource.md)

Defined in: [abilities-resolver/resolver.ts:66](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L66)

***

### phases

> **phases**: [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [abilities-resolver/resolver.ts:68](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L68)

The subset of `ability.phases` that intersect the requested phase.

***

### rating?

> `optional` **rating?**: `string` \| `number`

Defined in: [abilities-resolver/resolver.ts:70](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L70)

The rating the owning unit prints for a rated rule (Feel No Pain 5+ → 5).
