[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / BuffApplicability

# Type Alias: BuffApplicability

> **BuffApplicability** = `object`

Defined in: [cruncher/buffs.ts:140](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L140)

Optional gating; the resolver drops buffs whose gate fails.

## Properties

### phases?

> `optional` **phases?**: [`Phase`](../../generated/type-aliases/Phase.md)[]

Defined in: [cruncher/buffs.ts:141](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L141)

***

### rollType?

> `optional` **rollType?**: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`

Defined in: [cruncher/buffs.ts:142](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L142)

***

### onCritical?

> `optional` **onCritical?**: `"wound"`

Defined in: [cruncher/buffs.ts:147](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L147)

Only on a critical wound: the engine applies the buff's AP and Damage to the attacks that
score one, and no other stage reads it.

***

### requiresTargetKeyword?

> `optional` **requiresTargetKeyword?**: `string`

Defined in: [cruncher/buffs.ts:149](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L149)

Target must carry this keyword (case-insensitive).

***

### requiresAttackerKeyword?

> `optional` **requiresAttackerKeyword?**: `string`

Defined in: [cruncher/buffs.ts:151](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L151)

Attacker must carry this keyword (case-insensitive).

***

### attackerFilter?

> `optional` **attackerFilter?**: `Record`\<`string`, `unknown`\>

Defined in: [cruncher/buffs.ts:152](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L152)

***

### targetFilter?

> `optional` **targetFilter?**: `Record`\<`string`, `unknown`\>

Defined in: [cruncher/buffs.ts:153](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L153)

***

### excludedTargetKeywords?

> `optional` **excludedTargetKeywords?**: `string`[]

Defined in: [cruncher/buffs.ts:155](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L155)

Target must carry none of these keywords (case-insensitive). Permissive when the target's keywords are unknown.

***

### maxRangeInches?

> `optional` **maxRangeInches?**: `number`

Defined in: [cruncher/buffs.ts:161](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L161)

Fixed-distance applicability lowered from canonical range predicates.
Requires a known target distance at or within this inclusive maximum;
absent distance does not establish eligibility.

***

### weaponName?

> `optional` **weaponName?**: `string`

Defined in: [cruncher/buffs.ts:166](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L166)

Only attacks with the weapon of this name (lower case). Missing weapon context does not
establish a match; the engine always supplies its names.

***

### weaponKeywords?

> `optional` **weaponKeywords?**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:168](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L168)

Structured keyword selectors: inclusion matches any, exclusions reject any.

***

### excludedWeaponKeywords?

> `optional` **excludedWeaponKeywords?**: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md)[]

Defined in: [cruncher/buffs.ts:169](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L169)

***

### excludedWeaponName?

> `optional` **excludedWeaponName?**: `string`

Defined in: [cruncher/buffs.ts:170](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L170)

***

### weaponRequirements?

> `optional` **weaponRequirements?**: `BuffApplicability`[]

Defined in: [cruncher/buffs.ts:172](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L172)

Additional conjunctive weapon predicates inherited from enclosing effects.

***

### attackComparisons?

> `optional` **attackComparisons?**: `AttackComparison`[]

Defined in: [cruncher/buffs.ts:177](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/buffs.ts#L177)

Conjunctive comparisons of the attack's characteristics (the attack's Strength against the
target's Toughness). A comparison whose characteristic the context lacks does not hold.
