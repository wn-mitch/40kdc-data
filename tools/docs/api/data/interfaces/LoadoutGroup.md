[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / LoadoutGroup

# Interface: LoadoutGroup

Defined in: [data/loadout.ts:451](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L451)

A set of identically-equipped models within a unit: `count` models of model-type
`model_name`, each carrying `weapons` (counts are *per model*). Produced by
[groupLoadout](../functions/groupLoadout.md) so an exporter can render "Nx <model>: <loadout>" lines
instead of one unit-wide weapon bag. Mirror of `crates/wh40kdc/src/data/loadout.rs`.

## Properties

### model\_name

> **model\_name**: `string` \| `null`

Defined in: [data/loadout.ts:452](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L452)

***

### count

> **count**: `number`

Defined in: [data/loadout.ts:453](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L453)

***

### weapons

> **weapons**: [`LoadoutGroupWeapon`](LoadoutGroupWeapon.md)[]

Defined in: [data/loadout.ts:454](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L454)
