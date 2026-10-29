[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / LoadoutGroup

# Interface: LoadoutGroup

Defined in: [data/loadout.ts:486](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L486)

A set of identically-equipped models within a unit: `count` models of model-type
`model_name`, each carrying `weapons` (counts are *per model*). Produced by
[groupLoadout](../functions/groupLoadout.md) so an exporter can render "Nx <model>: <loadout>" lines
instead of one unit-wide weapon bag. Mirror of `crates/wh40kdc/src/data/loadout.rs`.

## Properties

### model\_name

> **model\_name**: `string` \| `null`

Defined in: [data/loadout.ts:487](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L487)

***

### count

> **count**: `number`

Defined in: [data/loadout.ts:488](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L488)

***

### weapons

> **weapons**: [`LoadoutGroupWeapon`](LoadoutGroupWeapon.md)[]

Defined in: [data/loadout.ts:489](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/loadout.ts#L489)
