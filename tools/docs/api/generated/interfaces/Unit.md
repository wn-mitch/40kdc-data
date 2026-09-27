[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Unit

# Interface: Unit

Defined in: [generated.ts:4047](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4047)

A unit datasheet entry with stat profiles and point costs.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:4048](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4048)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:4049](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4049)

***

### name

> **name**: `string`

Defined in: [generated.ts:4050](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4050)

***

### aliases?

> `optional` **aliases?**: `string`[]

Defined in: [generated.ts:4054](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4054)

Alternate names this unit is known by (e.g. spelling variants in other tools' roster exports). Consulted by name lookup so an import matches despite a spelling difference; never displayed.

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:4055](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4055)

***

### role?

> `optional` **role?**: `"character"` \| `"battleline"` \| `"dedicated-transport"` \| `"fortification"` \| `"allied"` \| `"epic-hero"`

Defined in: [generated.ts:4059](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4059)

Battlefield role from the datasheet header. Unit types (Infantry, Vehicle, etc.) belong in keywords.

***

### attachment\_role?

> `optional` **attachment\_role?**: `"leader"` \| `"support"` \| `null`

Defined in: [generated.ts:4063](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4063)

Character attachment role (11e). 'support' implies the unit is only legal when attached to a host unit (cannot be taken solo); 'leader' is valid as a standalone list entry. null/absent for non-attaching units.

***

### profiles

> **profiles**: \[\{\[`k`: `string`\]: `unknown`; `name?`: `string`; `M`: [`StatValue`](../type-aliases/StatValue.md); `T`: `number`; `W`: `number`; `Sv`: `number`; `invuln_sv?`: `number` \| `null`; `invuln_sv_ranged?`: `number` \| `null`; `invuln_sv_melee?`: `number` \| `null`; `Ld`: `number`; `OC`: `number`; \}, ...\{ name?: string; M: StatValue; T: number; W: number; Sv: number; invuln\_sv?: number \| null; invuln\_sv\_ranged?: number \| null; invuln\_sv\_melee?: number \| null; Ld: number; OC: number; \[k: string\]: unknown \}\[\]\]

Defined in: [generated.ts:4067](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4067)

#### Min Items

1

***

### points?

> `optional` **points?**: `object`[]

Defined in: [generated.ts:4113](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4113)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### models

> **models**: `number`

Lowest model count this tier's cost applies to. For a single-size tier this is the only size; for a GW range-priced tier (block pricing) it is the range floor and `models_max` is the ceiling. `baseUnitPoints` prices a squad at the highest `models` threshold its count reaches.

#### cost

> **cost**: `number`

#### models\_max?

> `optional` **models\_max?**: `number`

Inclusive upper model count for a range-priced tier (GW block pricing, e.g. Venatari Custodians are 4–6 models for 320). `models` is the range floor; every size in [models, models_max] costs `cost`. Absent when the tier prices a single size (equivalent to models_max == models).

#### unit\_count\_min?

> `optional` **unit\_count\_min?**: `number`

11e per-army-ordinal pricing: the first army-copy count (1-based) this tier's cost applies to. Absent (together with unit_count_max) means the cost applies to every copy — the common case. Present only for datasheets the MFM prices by how many you have taken (e.g. 'your 1st-2nd units cost X, your 3rd+ unit costs Y').

#### unit\_count\_max?

> `optional` **unit\_count\_max?**: `number` \| `null`

Inclusive upper army-copy count for this tier's band, or null for an open-ended top band ('3rd+ unit'). Absent when unit_count_min is absent.

***

### allied\_points?

> `optional` **allied\_points?**: `object`[]

Defined in: [generated.ts:4136](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4136)

11e: alternate point costs that apply only when this unit is included in a host army of another faction (e.g. an Agents of the Imperium unit allied into any IMPERIUM army). Each entry mirrors a `points` tier but is scoped to a `host_faction`. Absent for the common case where the unit costs the same everywhere; consumers that don't model allied pricing read `points` (the native cost) and ignore this.

#### host\_faction

> **host\_faction**: `string`

Kebab-case identifier

#### models

> **models**: `number`

#### cost

> **cost**: `number`

#### models\_max?

> `optional` **models\_max?**: `number`

#### unit\_count\_min?

> `optional` **unit\_count\_min?**: `number`

#### unit\_count\_max?

> `optional` **unit\_count\_max?**: `number` \| `null`

***

### points\_provisional?

> `optional` **points\_provisional?**: `boolean`

Defined in: [generated.ts:4150](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4150)

True when point costs are carried over provisionally (e.g. seeded from a prior edition during migration) and not yet confirmed against the current dataslate.

***

### wargear\_costs?

> `optional` **wargear\_costs?**: `object`[]

Defined in: [generated.ts:4154](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4154)

Per-item MFM wargear prices that the option-level `additional_cost` on wargear-option records cannot express: priced default-loadout items (e.g. a Terminator Assault Squad's thunder hammers, which are the default with only a swap-away option to hang a cost on) and heterogeneous choice groups where only some items in a group cost points. Each entry charges `cost` points for every copy of `item_id` in the unit's FINAL loadout (defaults included). Additive and optional — a consumer that ignores it prices this wargear as free, exactly as before. Sourced authoritatively from the MFM dump (`wargear_option.points`).

#### item\_id

> **item\_id**: `string`

Kebab-case identifier

#### cost

> **cost**: `number`

Points charged per copy of `item_id` present in the final loadout.

***

### keywords?

> `optional` **keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:4164](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4164)

***

### faction\_keywords?

> `optional` **faction\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:4165](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4165)

***

### conditional\_keywords?

> `optional` **conditional\_keywords?**: `object`[]

Defined in: [generated.ts:4169](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4169)

Keywords granted to this unit only when roster construction satisfies the source condition. Conditions are conjunctive within an entry; entries are independent grants.

#### keyword

> **keyword**: `string`

#### required\_detachment\_id?

> `optional` **required\_detachment\_id?**: `string` \| `null`

#### required\_faction\_keyword?

> `optional` **required\_faction\_keyword?**: `string` \| `null`

***

### excluded\_faction\_keywords?

> `optional` **excluded\_faction\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md) \| `null`

Defined in: [generated.ts:4177](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4177)

Faction keywords whose armies are barred from taking this otherwise-generic unit. Used where the game removes a generic unit from a specific sub-faction without printing a replacement (e.g. Black Templars cannot field Librarians; Deathwatch cannot field the generic Tactical Squad). An army may take this unit only if none of its faction keywords appear here. Absent/empty = available to every keyword-eligible army. Distinct from `faction_keywords`, which is the positive access list; this is the negative one for the rare exclusions a flat shared pool cannot otherwise express.

***

### base\_size\_mm?

> `optional` **base\_size\_mm?**: [`BaseSize`](BaseSize.md) \| `null`

Defined in: [generated.ts:4181](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4181)

The unit's representative base (the most-numerous model's base). Mixed-model units carry the full per-model breakdown in unit-composition; this top-level value is a convenience for consumers that need a single base.

***

### model\_count?

> `optional` **model\_count?**: `object`

Defined in: [generated.ts:4182](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4182)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### min

> **min**: `number`

#### max

> **max**: `number`

***

### weapon\_ids?

> `optional` **weapon\_ids?**: `string`[]

Defined in: [generated.ts:4187](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4187)

***

### ability\_ids?

> `optional` **ability\_ids?**: `string`[]

Defined in: [generated.ts:4188](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4188)

***

### wargear\_budgets?

> `optional` **wargear\_budgets?**: `object`[]

Defined in: [generated.ts:4192](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4192)

Limited-wargear squad allowances the per-weapon bounds cannot express: a GW `limited_wargear_choice_set` that is either (a) SHARED across several weapons (a 'for every N models, one model can take one of A/B/C' line) or (b) a FLAT per-unit cap ('up to 1 per unit'). A loadout is legal only if the summed count of a budget's items is at most the cap: `floor(model_count * count / per_models)` for a ratio, or just `count` when `per_models` is 0 (a flat per-unit cap). Single-weapon per-N allowances are NOT budgets — the per-weapon bounds already model them (they correctly sum a weapon's capacity across the model types that may take it).

#### items

> **items**: \[`string`, `...string[]`\]

##### Min Items

1

#### count

> **count**: `number`

#### per\_models

> **per\_models**: `number`

Models per `count` allowance; 0 means a flat per-unit cap of `count` (independent of squad size).

#### duplicate\_limit?

> `optional` **duplicate\_limit?**: `number`

Optional per-item sub-cap: at most this many copies of any SINGLE item in the set — `floor(model_count * duplicate_limit / per_models)` for a ratio, or `duplicate_limit` when `per_models` is 0. Absent means the shared `count` cap is the only bound (any one item may fill the whole allowance).

***

### transport\_capacity?

> `optional` **transport\_capacity?**: \{ `capacity`: `number`; `keyword_restrictions?`: [`KeywordList`](../type-aliases/KeywordList.md) \| `null`; `exclusion_keywords?`: [`KeywordList`](../type-aliases/KeywordList.md) \| `null`; \} \| `null`

Defined in: [generated.ts:4207](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4207)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:4212](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4212)

***

### is\_legend?

> `optional` **is\_legend?**: `boolean`

Defined in: [generated.ts:4213](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4213)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes5`](../type-aliases/GameModes5.md)

Defined in: [generated.ts:4214](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4214)
