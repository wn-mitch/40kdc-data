[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EligibilityInput

# Type Alias: EligibilityInput

> **EligibilityInput** = `object`

Defined in: [abilities-resolver/resolver.ts:46](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L46)

## Properties

### unitId

> **unitId**: `string`

Defined in: [abilities-resolver/resolver.ts:47](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L47)

***

### factionId?

> `optional` **factionId?**: `string`

Defined in: [abilities-resolver/resolver.ts:49](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L49)

Overrides the unit's own `faction_id` when given (for inheritance cases).

***

### detachmentId?

> `optional` **detachmentId?**: `string`

Defined in: [abilities-resolver/resolver.ts:50](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L50)

***

### attachedUnitIds?

> `optional` **attachedUnitIds?**: `string`[]

Defined in: [abilities-resolver/resolver.ts:57](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L57)

Other members of the combined ("attached") unit — the attached leader, its
bodyguard, or (11th) support attachments — whichever is *not* the selected
`unitId`. Their abilities are pooled onto the combined unit. A list so
multi-member attachments need no shape change; order is preserved.

***

### attachmentRoles?

> `optional` **attachmentRoles?**: `Readonly`\<`Record`\<`string`, `"leader"` \| `"bodyguard"`\>\>

Defined in: [abilities-resolver/resolver.ts:59](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L59)

Actual roles within this attached unit, keyed by unit id; never inferred from datasheet abilities.

***

### supportingUnitIds?

> `optional` **supportingUnitIds?**: `string`[]

Defined in: [abilities-resolver/resolver.ts:61](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L61)

Friendly units whose auras could apply (M2 walks only their aura-ranged abilities).
