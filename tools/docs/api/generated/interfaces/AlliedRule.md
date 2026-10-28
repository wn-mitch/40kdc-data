[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedRule

# Interface: AlliedRule

Defined in: [generated.ts:2772](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2772)

A community-authored model of an allied-detachment / 'soup' rule: the named exception by which units lacking the army's chosen Faction keyword may still be included (e.g. Daemonic Pact, Brood Brothers, Iconoclast Fiefdom's Damned access). One rule = one allied source pool; a faction that allies in several pools (the Chaos cult pattern: a Chaos Knights pool plus a matching-god Daemons pool) carries one rule per pool. The rule is gated by two optional, AND-combined conditions: an army-wide keyword condition (`army_keywords_any`) and/or a selected detachment (`detachment_ids`).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-rule".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:2773](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2773)

***

### name

> **name**: `string`

Defined in: [generated.ts:2774](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2774)

***

### label?

> `optional` **label?**: `string`

Defined in: [generated.ts:2778](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2778)

Short panel/category heading a list builder groups this pool under (e.g. 'Daemons', 'Imperial Agents', 'Titanic Allies'). Defaults to `name` when omitted.

***

### army\_keywords\_any?

> `optional` **army\_keywords\_any?**: [`KeywordList3`](../type-aliases/KeywordList3.md)

Defined in: [generated.ts:2779](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2779)

***

### detachment\_ids?

> `optional` **detachment\_ids?**: `string`[]

Defined in: [generated.ts:2783](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2783)

Detachment gate: the rule applies only when at least one listed detachment is selected. Empty/absent = no detachment gate. Replaces the former single detachment_id (GW pools may gate on several detachments).

***

### source\_faction\_id?

> `optional` **source\_faction\_id?**: `string` \| `null`

Defined in: [generated.ts:2787](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2787)

Faction the ally pool is drawn from, when scoping by faction is needed to disambiguate units whose id is shared across factions. Optional hint; `source_keywords` is the primary filter.

***

### source\_keywords?

> `optional` **source\_keywords?**: [`KeywordList4`](../type-aliases/KeywordList4.md)

Defined in: [generated.ts:2788](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2788)

***

### source\_datasheet\_ids?

> `optional` **source\_datasheet\_ids?**: `string`[]

Defined in: [generated.ts:2792](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2792)

Explicit datasheet allowlist: when non-empty, a unit qualifies only if its id is listed (AND-combined with source_keywords/required_keywords/excluded_keywords/roles). GW soup pools enumerate by datasheet; this is the primary unit selector for generated rules. Empty/absent = no datasheet-level restriction.

***

### required\_keywords?

> `optional` **required\_keywords?**: [`KeywordList5`](../type-aliases/KeywordList5.md)

Defined in: [generated.ts:2793](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2793)

***

### excluded\_keywords?

> `optional` **excluded\_keywords?**: [`KeywordList6`](../type-aliases/KeywordList6.md)

Defined in: [generated.ts:2794](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2794)

***

### roles?

> `optional` **roles?**: `string`[]

Defined in: [generated.ts:2798](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2798)

Optional battlefield-role filter (matched against a unit's `role`). Empty = no role restriction.

***

### points\_limits?

> `optional` **points\_limits?**: [`AlliedPointsLimit`](AlliedPointsLimit.md)[]

Defined in: [generated.ts:2802](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2802)

Absolute points cap on the combined cost of units included via this rule, per battle size. Empty = no points cap. A rule lists at most one entry per battle size.

***

### keyword\_limits?

> `optional` **keyword\_limits?**: [`AlliedKeywordLimit`](AlliedKeywordLimit.md)[]

Defined in: [generated.ts:2806](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2806)

Per-keyword, per-battle-size cap on how many units carrying `keyword` may be included via this rule (e.g. Imperial Knights' Titanic 1 / Armiger 3; Agents of the Imperium's Character/Retinue/Requisitioned counts). Advisory construction cap.

***

### max\_units?

> `optional` **max\_units?**: `number` \| `null`

Defined in: [generated.ts:2810](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2810)

Optional cap on the number of units included via this rule, independent of points. null = no unit-count cap.

***

### exclusive?

> `optional` **exclusive?**: `boolean`

Defined in: [generated.ts:2814](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2814)

True when the pool's units are not part of the source faction's own roster: an army of `source_faction_id` may take them only through this rule (its detachment gate, caps and locks), never as ordinary picks. Models a sibling-faction pool printed in the host's own codex, e.g. World Eaters' Blood Legions daemons, available only under Khorne Daemonkin.

***

### cannot\_be\_warlord?

> `optional` **cannot\_be\_warlord?**: `boolean`

Defined in: [generated.ts:2818](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2818)

True when units included via this rule cannot be the army's Warlord (e.g. Daemonic Pact, Star Children's Blessings).

***

### cannot\_take\_enhancements?

> `optional` **cannot\_take\_enhancements?**: `boolean`

Defined in: [generated.ts:2822](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2822)

True when units included via this rule cannot be given Enhancements (e.g. Daemonic Pact).

***

### warlord\_required\_keyword?

> `optional` **warlord\_required\_keyword?**: `string` \| `null`

Defined in: [generated.ts:2826](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2826)

Host-Warlord requirement: a model carrying this keyword must be the army's Warlord (e.g. Brood Brothers requires a 'Genestealer Cults' Warlord). null = no such requirement.

***

### warlord\_datasheet\_ids?

> `optional` **warlord\_datasheet\_ids?**: `string`[]

Defined in: [generated.ts:2830](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2830)

Datasheet allowlist for which units included via this rule may be the army Warlord (the specific characters GW permits). Non-empty = only these may be Warlord among the pool's units; pair with cannot_be_warlord:false. Empty/absent = no per-datasheet warlord allowlist.

***

### removes\_ability\_ids?

> `optional` **removes\_ability\_ids?**: `string`[]

Defined in: [generated.ts:2834](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2834)

Abilities that included units lose under this rule (e.g. Astra Militarum units lose 'voice-of-command' under Brood Brothers). A display/effect hint, not a construction constraint.

***

### battleline\_ratio\_keywords?

> `optional` **battleline\_ratio\_keywords?**: [`KeywordList7`](../type-aliases/KeywordList7.md)

Defined in: [generated.ts:2835](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2835)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:2836](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2836)

***

### notes?

> `optional` **notes?**: `string`

Defined in: [generated.ts:2837](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2837)
