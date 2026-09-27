[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ShareUnit

# Interface: ShareUnit

Defined in: [share/codec.ts:50](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L50)

One unit in a [ShareList](ShareList.md). Mirrors the builder's per-row essentials.

## Properties

### datasheetId

> **datasheetId**: `string`

Defined in: [share/codec.ts:51](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L51)

***

### modelCount

> **modelCount**: `number`

Defined in: [share/codec.ts:52](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L52)

***

### isWarlord

> **isWarlord**: `boolean`

Defined in: [share/codec.ts:53](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L53)

***

### enhancementId

> **enhancementId**: `string` \| `null`

Defined in: [share/codec.ts:54](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L54)

***

### allyFactionId

> **allyFactionId**: `string` \| `null`

Defined in: [share/codec.ts:56](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L56)

Source faction id when this is an *allied* unit; null for own-faction.

***

### allyRuleId

> **allyRuleId**: `string` \| `null`

Defined in: [share/codec.ts:58](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L58)

Allied-rule id this unit was included under; null when not an ally.

***

### attachedToOrdinal

> **attachedToOrdinal**: `number` \| `null`

Defined in: [share/codec.ts:60](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L60)

Ordinal (into [ShareList.units](ShareList.md#units)) of the bodyguard this leader joins.

***

### grants

> **grants**: `string`[]

Defined in: [share/codec.ts:62](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L62)

Detachment keyword grants the player assigned to this unit.

***

### loadout

> **loadout**: [`ShareLoadoutEntry`](../type-aliases/ShareLoadoutEntry.md)[]

Defined in: [share/codec.ts:63](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/codec.ts#L63)
