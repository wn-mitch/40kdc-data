[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / BuffApplicability

# Type Alias: BuffApplicability

> **BuffApplicability** = `object`

Defined in: [cruncher/buffs.ts:108](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L108)

Optional gating; the resolver drops buffs whose gate fails.

## Properties

### phases?

> `optional` **phases?**: [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [cruncher/buffs.ts:109](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L109)

***

### rollType?

> `optional` **rollType?**: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`

Defined in: [cruncher/buffs.ts:110](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L110)

***

### requiresTargetKeyword?

> `optional` **requiresTargetKeyword?**: `string`

Defined in: [cruncher/buffs.ts:112](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L112)

Target must carry this keyword (case-insensitive).

***

### requiresAttackerKeyword?

> `optional` **requiresAttackerKeyword?**: `string`

Defined in: [cruncher/buffs.ts:114](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L114)

Attacker must carry this keyword (case-insensitive).

***

### attackerFilter?

> `optional` **attackerFilter?**: `Record`\<`string`, `unknown`\>

Defined in: [cruncher/buffs.ts:115](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L115)

***

### targetFilter?

> `optional` **targetFilter?**: `Record`\<`string`, `unknown`\>

Defined in: [cruncher/buffs.ts:116](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L116)

***

### excludedTargetKeywords?

> `optional` **excludedTargetKeywords?**: `string`[]

Defined in: [cruncher/buffs.ts:118](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L118)

Target must carry none of these keywords (case-insensitive). Permissive when the target's keywords are unknown.

***

### maxRangeInches?

> `optional` **maxRangeInches?**: `number`

Defined in: [cruncher/buffs.ts:124](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L124)

Fixed-distance applicability lowered from canonical range predicates.
Requires a known target distance at or within this inclusive maximum;
absent distance does not establish eligibility.

***

### weaponName?

> `optional` **weaponName?**: `string`

Defined in: [cruncher/buffs.ts:129](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L129)

Only attacks with the weapon of this name (lower case). Missing weapon context does not
establish a match; the engine always supplies its names.

***

### weaponKeywords?

> `optional` **weaponKeywords?**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:131](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L131)

Structured keyword selectors: inclusion matches any, exclusions reject any.

***

### excludedWeaponKeywords?

> `optional` **excludedWeaponKeywords?**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:132](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L132)

***

### excludedWeaponName?

> `optional` **excludedWeaponName?**: `string`

Defined in: [cruncher/buffs.ts:133](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L133)

***

### weaponRequirements?

> `optional` **weaponRequirements?**: `BuffApplicability`[]

Defined in: [cruncher/buffs.ts:135](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/cruncher/buffs.ts#L135)

Additional conjunctive weapon predicates inherited from enclosing effects.
