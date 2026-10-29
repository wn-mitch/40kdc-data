[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / BuffApplicability

# Type Alias: BuffApplicability

> **BuffApplicability** = `object`

Defined in: [cruncher/buffs.ts:133](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L133)

Optional gating; the resolver drops buffs whose gate fails.

## Properties

### phases?

> `optional` **phases?**: [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [cruncher/buffs.ts:134](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L134)

***

### rollType?

> `optional` **rollType?**: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`

Defined in: [cruncher/buffs.ts:135](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L135)

***

### onCritical?

> `optional` **onCritical?**: `"wound"`

Defined in: [cruncher/buffs.ts:140](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L140)

Only on a critical wound: the engine applies the buff's AP and Damage to the attacks that
score one, and no other stage reads it.

***

### requiresTargetKeyword?

> `optional` **requiresTargetKeyword?**: `string`

Defined in: [cruncher/buffs.ts:142](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L142)

Target must carry this keyword (case-insensitive).

***

### requiresAttackerKeyword?

> `optional` **requiresAttackerKeyword?**: `string`

Defined in: [cruncher/buffs.ts:144](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L144)

Attacker must carry this keyword (case-insensitive).

***

### attackerFilter?

> `optional` **attackerFilter?**: `Record`\<`string`, `unknown`\>

Defined in: [cruncher/buffs.ts:145](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L145)

***

### targetFilter?

> `optional` **targetFilter?**: `Record`\<`string`, `unknown`\>

Defined in: [cruncher/buffs.ts:146](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L146)

***

### excludedTargetKeywords?

> `optional` **excludedTargetKeywords?**: `string`[]

Defined in: [cruncher/buffs.ts:148](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L148)

Target must carry none of these keywords (case-insensitive). Permissive when the target's keywords are unknown.

***

### maxRangeInches?

> `optional` **maxRangeInches?**: `number`

Defined in: [cruncher/buffs.ts:154](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L154)

Fixed-distance applicability lowered from canonical range predicates.
Requires a known target distance at or within this inclusive maximum;
absent distance does not establish eligibility.

***

### weaponName?

> `optional` **weaponName?**: `string`

Defined in: [cruncher/buffs.ts:159](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L159)

Only attacks with the weapon of this name (lower case). Missing weapon context does not
establish a match; the engine always supplies its names.

***

### weaponKeywords?

> `optional` **weaponKeywords?**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:161](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L161)

Structured keyword selectors: inclusion matches any, exclusions reject any.

***

### excludedWeaponKeywords?

> `optional` **excludedWeaponKeywords?**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:162](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L162)

***

### excludedWeaponName?

> `optional` **excludedWeaponName?**: `string`

Defined in: [cruncher/buffs.ts:163](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L163)

***

### weaponRequirements?

> `optional` **weaponRequirements?**: `BuffApplicability`[]

Defined in: [cruncher/buffs.ts:165](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L165)

Additional conjunctive weapon predicates inherited from enclosing effects.

***

### attackComparisons?

> `optional` **attackComparisons?**: `AttackComparison`[]

Defined in: [cruncher/buffs.ts:170](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L170)

Conjunctive comparisons of the attack's characteristics (the attack's Strength against the
target's Toughness). A comparison whose characteristic the context lacks does not hold.
