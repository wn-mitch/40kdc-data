[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EligibilityInput

# Type Alias: EligibilityInput

> **EligibilityInput** = `object`

Defined in: [abilities-resolver/resolver.ts:40](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L40)

## Properties

### unitId

> **unitId**: `string`

Defined in: [abilities-resolver/resolver.ts:41](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L41)

***

### factionId?

> `optional` **factionId?**: `string`

Defined in: [abilities-resolver/resolver.ts:43](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L43)

Overrides the unit's own `faction_id` when given (for inheritance cases).

***

### detachmentId?

> `optional` **detachmentId?**: `string`

Defined in: [abilities-resolver/resolver.ts:44](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L44)

***

### attachedUnitIds?

> `optional` **attachedUnitIds?**: `string`[]

Defined in: [abilities-resolver/resolver.ts:51](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L51)

Other members of the combined ("attached") unit — the attached leader, its
bodyguard, or (11th) support attachments — whichever is *not* the selected
`unitId`. Their abilities are pooled onto the combined unit. A list so
multi-member attachments need no shape change; order is preserved.

***

### attachmentRoles?

> `optional` **attachmentRoles?**: `Readonly`\<`Record`\<`string`, `"leader"` \| `"bodyguard"`\>\>

Defined in: [abilities-resolver/resolver.ts:53](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L53)

Actual roles within this attached unit, keyed by unit id; never inferred from datasheet abilities.

***

### supportingUnitIds?

> `optional` **supportingUnitIds?**: `string`[]

Defined in: [abilities-resolver/resolver.ts:55](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/abilities-resolver/resolver.ts#L55)

Friendly units whose auras could apply (M2 walks only their aura-ranged abilities).
