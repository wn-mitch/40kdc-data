[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedRule

# Interface: AlliedRule

Defined in: [generated.ts:1142](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1142)

A community-authored model of an allied-detachment / 'soup' rule: the named exception by which units lacking the army's chosen Faction keyword may still be included (e.g. Daemonic Pact, Brood Brothers, Iconoclast Fiefdom's Damned access). One rule = one allied source pool; a faction that allies in several pools (the Chaos cult pattern: a Chaos Knights pool plus a matching-god Daemons pool) carries one rule per pool. The rule is gated by two optional, AND-combined conditions: an army-wide keyword condition (`army_keywords_any`) and/or a selected detachment (`detachment_ids`).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-rule".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1143](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1143)

***

### name

> **name**: `string`

Defined in: [generated.ts:1144](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1144)

***

### label?

> `optional` **label?**: `string`

Defined in: [generated.ts:1148](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1148)

Short panel/category heading a list builder groups this pool under (e.g. 'Daemons', 'Imperial Agents', 'Titanic Allies'). Defaults to `name` when omitted.

***

### army\_keywords\_any?

> `optional` **army\_keywords\_any?**: [`KeywordList1`](../type-aliases/KeywordList1.md)

Defined in: [generated.ts:1149](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1149)

***

### detachment\_ids?

> `optional` **detachment\_ids?**: `string`[]

Defined in: [generated.ts:1153](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1153)

Detachment gate: the rule applies only when at least one listed detachment is selected. Empty/absent = no detachment gate. Replaces the former single detachment_id (GW pools may gate on several detachments).

***

### source\_faction\_id?

> `optional` **source\_faction\_id?**: `string` \| `null`

Defined in: [generated.ts:1157](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1157)

Faction the ally pool is drawn from, when scoping by faction is needed to disambiguate units whose id is shared across factions. Optional hint; `source_keywords` is the primary filter.

***

### source\_keywords?

> `optional` **source\_keywords?**: [`KeywordList2`](../type-aliases/KeywordList2.md)

Defined in: [generated.ts:1158](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1158)

***

### source\_datasheet\_ids?

> `optional` **source\_datasheet\_ids?**: `string`[]

Defined in: [generated.ts:1162](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1162)

Explicit datasheet allowlist: when non-empty, a unit qualifies only if its id is listed (AND-combined with source_keywords/required_keywords/excluded_keywords/roles). GW soup pools enumerate by datasheet; this is the primary unit selector for generated rules. Empty/absent = no datasheet-level restriction.

***

### required\_keywords?

> `optional` **required\_keywords?**: [`KeywordList3`](../type-aliases/KeywordList3.md)

Defined in: [generated.ts:1163](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1163)

***

### excluded\_keywords?

> `optional` **excluded\_keywords?**: [`KeywordList4`](../type-aliases/KeywordList4.md)

Defined in: [generated.ts:1164](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1164)

***

### roles?

> `optional` **roles?**: `string`[]

Defined in: [generated.ts:1168](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1168)

Optional battlefield-role filter (matched against a unit's `role`). Empty = no role restriction.

***

### points\_limits?

> `optional` **points\_limits?**: [`AlliedPointsLimit`](AlliedPointsLimit.md)[]

Defined in: [generated.ts:1172](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1172)

Absolute points cap on the combined cost of units included via this rule, per battle size. Empty = no points cap. A rule lists at most one entry per battle size.

***

### keyword\_limits?

> `optional` **keyword\_limits?**: [`AlliedKeywordLimit`](AlliedKeywordLimit.md)[]

Defined in: [generated.ts:1176](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1176)

Per-keyword, per-battle-size cap on how many units carrying `keyword` may be included via this rule (e.g. Imperial Knights' Titanic 1 / Armiger 3; Agents of the Imperium's Character/Retinue/Requisitioned counts). Advisory construction cap.

***

### max\_units?

> `optional` **max\_units?**: `number` \| `null`

Defined in: [generated.ts:1180](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1180)

Optional cap on the number of units included via this rule, independent of points. null = no unit-count cap.

***

### cannot\_be\_warlord?

> `optional` **cannot\_be\_warlord?**: `boolean`

Defined in: [generated.ts:1184](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1184)

True when units included via this rule cannot be the army's Warlord (e.g. Daemonic Pact, Star Children's Blessings).

***

### cannot\_take\_enhancements?

> `optional` **cannot\_take\_enhancements?**: `boolean`

Defined in: [generated.ts:1188](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1188)

True when units included via this rule cannot be given Enhancements (e.g. Daemonic Pact).

***

### warlord\_required\_keyword?

> `optional` **warlord\_required\_keyword?**: `string` \| `null`

Defined in: [generated.ts:1192](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1192)

Host-Warlord requirement: a model carrying this keyword must be the army's Warlord (e.g. Brood Brothers requires a 'Genestealer Cults' Warlord). null = no such requirement.

***

### warlord\_datasheet\_ids?

> `optional` **warlord\_datasheet\_ids?**: `string`[]

Defined in: [generated.ts:1196](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1196)

Datasheet allowlist for which units included via this rule may be the army Warlord (the specific characters GW permits). Non-empty = only these may be Warlord among the pool's units; pair with cannot_be_warlord:false. Empty/absent = no per-datasheet warlord allowlist.

***

### removes\_ability\_ids?

> `optional` **removes\_ability\_ids?**: `string`[]

Defined in: [generated.ts:1200](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1200)

Abilities that included units lose under this rule (e.g. Astra Militarum units lose 'voice-of-command' under Brood Brothers). A display/effect hint, not a construction constraint.

***

### battleline\_ratio\_keywords?

> `optional` **battleline\_ratio\_keywords?**: [`KeywordList5`](../type-aliases/KeywordList5.md)

Defined in: [generated.ts:1201](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1201)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1202](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1202)

***

### notes?

> `optional` **notes?**: `string`

Defined in: [generated.ts:1203](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1203)
