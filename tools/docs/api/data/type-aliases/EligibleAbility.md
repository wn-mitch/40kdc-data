[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EligibleAbility

# Type Alias: EligibleAbility

> **EligibleAbility** = `object`

Defined in: [abilities-resolver/resolver.ts:58](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L58)

## Properties

### ability

> **ability**: [`AbilityView`](../classes/AbilityView.md)

Defined in: [abilities-resolver/resolver.ts:59](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L59)

***

### source

> **source**: [`EligibleAbilitySource`](EligibleAbilitySource.md)

Defined in: [abilities-resolver/resolver.ts:60](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L60)

***

### phases

> **phases**: [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [abilities-resolver/resolver.ts:62](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L62)

The subset of `ability.phases` that intersect the requested phase.

***

### rating?

> `optional` **rating?**: `string` \| `number`

Defined in: [abilities-resolver/resolver.ts:64](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L64)

The rating the owning unit prints for a rated rule (Feel No Pain 5+ → 5).
