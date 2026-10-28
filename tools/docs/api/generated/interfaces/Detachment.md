[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Detachment

# Interface: Detachment

Defined in: [generated.ts:2928](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2928)

A detachment option within a faction, providing a detachment rule, enhancements, and stratagems.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "detachment".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:2929](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2929)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:2930](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2930)

***

### name

> **name**: `string`

Defined in: [generated.ts:2931](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2931)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:2932](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2932)

***

### detachment\_rule\_id?

> `optional` **detachment\_rule\_id?**: `string` \| `null`

Defined in: [generated.ts:2936](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2936)

Deprecated single-rule link, kept for back-compat (and referenced by allied-rule). A detachment may have more than one rule ability — prefer `detachment_rule_ids`.

***

### detachment\_rule\_ids?

> `optional` **detachment\_rule\_ids?**: `string`[]

Defined in: [generated.ts:2940](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2940)

ability_ids of every detachment-rule ability this detachment provides (a detachment rule may have multiple named parts). These match the enrichment `abilities.json` / raw-text-store ids, so the downstream lookup `store[ability_id]` resolves. Empty/absent until linked by author:reconcile.

***

### detachment\_points?

> `optional` **detachment\_points?**: `number` \| `null`

Defined in: [generated.ts:2944](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2944)

11e: the detachment-point cost (1–3) charged against the army's detachment-point budget. null when not yet assigned.

***

### force\_dispositions?

> `optional` **force\_dispositions?**: `string`[]

Defined in: [generated.ts:2948](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2948)

11e: ids of the Force Disposition entities this detachment grants. Empty until assigned.

***

### tags?

> `optional` **tags?**: `string`[]

Defined in: [generated.ts:2952](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2952)

11e: detachment-type tags (e.g. 'dynasty', 'kabal'). A roster may include at most one detachment per shared tag — the 'you can only take one of X type of detachment' rule. Empty when the detachment carries no UNIQUE tag.

***

### enhancement\_ids?

> `optional` **enhancement\_ids?**: `string`[]

Defined in: [generated.ts:2953](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2953)

***

### stratagem\_ids?

> `optional` **stratagem\_ids?**: `string`[]

Defined in: [generated.ts:2954](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2954)

***

### restrictions?

> `optional` **restrictions?**: \{ `required_keywords?`: [`KeywordList`](../type-aliases/KeywordList.md); `excluded_keywords?`: [`KeywordList`](../type-aliases/KeywordList.md); `notes?`: `string`; \} \| `null`

Defined in: [generated.ts:2955](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2955)

***

### granted\_keywords?

> `optional` **granted\_keywords?**: [`GrantedKeyword`](GrantedKeyword.md)[]

Defined in: [generated.ts:2963](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2963)

Construction keywords this detachment grants to matching units while it is selected (e.g. Houndpack Lance grants 'Battleline' to 'War Dog' units). A unit carrying any keyword in a grant's `to_keywords` gains that grant's `keyword` for army-construction purposes (datasheet-count caps, battlefield role). Empty/absent when the detachment grants no construction keywords. Distinct from combat keywords, which live in the ability DSL.

***

### unit\_minimums?

> `optional` **unit\_minimums?**: [`UnitMinimum`](UnitMinimum.md)[]

Defined in: [generated.ts:2967](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2967)

Minimum unit counts the detachment requires while selected (e.g. Houndpack Lance: 'your army must include three or more WAR DOG units'). Each entry requires at least `min` units carrying `keyword`. Empty/absent when the detachment imposes no minimum.

***

### mandatory\_warlord\_datasheet\_ids?

> `optional` **mandatory\_warlord\_datasheet\_ids?**: `string`[]

Defined in: [generated.ts:2971](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2971)

While this detachment is selected, the army's Warlord must be one of these datasheets (e.g. Devoted of Ynnead: Yvraine or The Yncarne). The requirement also makes them eligible to be Warlord when an allied rule would otherwise bar it. Empty/absent when the detachment imposes no Warlord requirement.

***

### granted\_warlord\_datasheet\_ids?

> `optional` **granted\_warlord\_datasheet\_ids?**: `string`[]

Defined in: [generated.ts:2975](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2975)

Datasheets this detachment allows to be the army's Warlord while it is selected, even when the allied rule they were included under bars it (e.g. Ghosts of the Webway: a Troupe Master, Shadowseer or Death Jester). A permission, not a requirement. Empty/absent when the detachment grants none.

***

### keyword\_limit\_overrides?

> `optional` **keyword\_limit\_overrides?**: `object`[]

Defined in: [generated.ts:2979](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2979)

Replacement caps for the army faction's `keyword_limits` while this detachment is selected (e.g. Ghosts of the Webway: up to three TROUPE MASTER units instead of one). An entry applies to the faction cap with the identical `keywords` set. Empty/absent when the detachment changes no cap.

#### keywords

> **keywords**: [`KeywordList`](../type-aliases/KeywordList.md)

#### max

> **max**: `number`

***

### excluded\_datasheet\_ids?

> `optional` **excluded\_datasheet\_ids?**: `string`[]

Defined in: [generated.ts:2986](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2986)

Datasheets an army cannot include while this detachment is selected (e.g. Shadow Legion bars named Greater Daemons such as Skarbrand). Empty/absent when the detachment bars none.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:2987](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2987)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes1`](../type-aliases/GameModes1.md)

Defined in: [generated.ts:2988](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2988)
