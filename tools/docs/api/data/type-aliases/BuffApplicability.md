[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / BuffApplicability

# Type Alias: BuffApplicability

> **BuffApplicability** = `object`

Defined in: [cruncher/buffs.ts:95](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L95)

Optional gating; the resolver drops buffs whose gate fails.

## Properties

### phases?

> `optional` **phases?**: [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [cruncher/buffs.ts:96](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L96)

***

### rollType?

> `optional` **rollType?**: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`

Defined in: [cruncher/buffs.ts:97](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L97)

***

### requiresTargetKeyword?

> `optional` **requiresTargetKeyword?**: `string`

Defined in: [cruncher/buffs.ts:99](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L99)

Target must carry this keyword (case-insensitive).

***

### requiresAttackerKeyword?

> `optional` **requiresAttackerKeyword?**: `string`

Defined in: [cruncher/buffs.ts:101](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L101)

Attacker must carry this keyword (case-insensitive).

***

### maxRangeInches?

> `optional` **maxRangeInches?**: `number`

Defined in: [cruncher/buffs.ts:108](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/buffs.ts#L108)

Range-gated abilities (DSL `scope.range_inches`, e.g. a "within 18\"" reroll):
the buff applies only when the target is within this many inches. Gate is
permissive when the caller leaves `EngineContext.distanceInches` undefined,
so callers that don't track distance keep their current behavior.
