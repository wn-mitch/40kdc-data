[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / wargearPoints

# Function: wargearPoints()

> **wargearPoints**(`unit`, `counts`): `number`

Defined in: [data/pricing.ts:153](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/pricing.ts#L153)

Per-item MFM wargear surcharge for a unit whose final loadout has `counts`
copies of each weapon/wargear id (see [Loadout](../interfaces/Loadout.md)). Each `unit.wargear_costs`
entry charges `cost` for every copy of `item_id` present — a Terminator Assault
Squad's five thunder hammers add 25, a Chapter Ancient's Banner of Macragge adds
10. Items with no cost entry are free. Absent `wargear_costs` (the common case)
contributes 0, so a unit's total is `baseUnitPoints + wargearPoints + enhancement`.
Mirror of `crates/wh40kdc/src/data/pricing.rs`.

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### counts

`ReadonlyMap`\<`string`, `number`\>

## Returns

`number`
