[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / LoadoutModel

# Interface: LoadoutModel

Defined in: [data/loadout.ts:150](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L150)

A unit-composition model row, as far as loadout maths cares: its count range,
whether it is a leader (taken at a fixed small count), and the weapons every
such model carries by default. Pass the unit's `unit_composition.models` here.

## Properties

### name?

> `optional` **name?**: `string`

Defined in: [data/loadout.ts:152](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L152)

Model-profile name; matched against an option's `model_constraint.model_name`.

***

### min

> **min**: `number`

Defined in: [data/loadout.ts:153](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L153)

***

### max

> **max**: `number`

Defined in: [data/loadout.ts:154](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L154)

***

### default\_weapon\_ids?

> `optional` **default\_weapon\_ids?**: readonly `string`[]

Defined in: [data/loadout.ts:155](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L155)

***

### is\_leader\_model?

> `optional` **is\_leader\_model?**: `boolean`

Defined in: [data/loadout.ts:156](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L156)

***

### loadout\_variants?

> `optional` **loadout\_variants?**: readonly `LoadoutVariant`[]

Defined in: [data/loadout.ts:157](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L157)

***

### loadout\_variant\_budgets?

> `optional` **loadout\_variant\_budgets?**: readonly `LoadoutVariantBudget`[]

Defined in: [data/loadout.ts:158](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L158)
