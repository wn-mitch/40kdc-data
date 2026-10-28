[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / BuffContribution

# Type Alias: BuffContribution

> **BuffContribution** = \{ `type`: `"hit-mod"`; `value`: `number`; \} \| \{ `type`: `"wound-mod"`; `value`: `number`; \} \| \{ `type`: `"save-mod"`; `value`: `number`; \} \| \{ `type`: `"cover"`; \} \| \{ `type`: `"reroll"`; `roll`: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`; `subset`: `"ones"` \| `"all-failures"`; \} \| \{ `type`: `"reroll-one"`; `roll`: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`; \} \| \{ `type`: `"extra-keyword"`; `keywordRef`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md); \} \| \{ `type`: `"feel-no-pain"`; `threshold`: `number`; `scope?`: `"all"` \| `"mortal"`; \} \| \{ `type`: `"damage-mod"`; `value`: `number`; \} \| \{ `type`: `"attacks-mod"`; `value`: `number`; \} \| \{ `type`: `"strength-mod"`; `value`: `number`; \} \| \{ `type`: `"toughness-mod"`; `value`: `number`; \} \| \{ `type`: `"ap-mod"`; `value`: `number`; \} \| \{ `type`: `"stat-set"`; `stat`: `SetStat`; `value`: `number`; \} \| \{ `type`: `"damage-reduction"`; `value`: `number`; \} \| \{ `type`: `"damage-zeroing"`; `uses`: `number`; `per`: `"unit"` \| `"model"`; \} \| \{ `type`: `"invulnerable-save"`; `threshold`: `number`; \} \| \{ `type`: `"crit-threshold"`; `roll`: `"hit"` \| `"wound"`; `value`: `number`; \} \| \{ `type`: `"ignore-modifiers"`; `roll`: `"hit"` \| `"wound"`; \} \| \{ `type`: `"skill-mod"`; `stat`: `"WS"` \| `"BS"`; `value`: `number`; \} \| \{ `type`: `"save-characteristic"`; `value`: `number`; \} \| \{ `type`: `"save-improve"`; `value`: `number`; `best`: `number`; \}

Defined in: [cruncher/buffs.ts:45](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/buffs.ts#L45)

One typed contribution; the engine reads `ResolvedModifiers` for the rest.

## Union Members

### Type Literal

\{ `type`: `"hit-mod"`; `value`: `number`; \}

***

### Type Literal

\{ `type`: `"wound-mod"`; `value`: `number`; \}

***

### Type Literal

\{ `type`: `"save-mod"`; `value`: `number`; \}

***

### Type Literal

\{ `type`: `"cover"`; \}

***

### Type Literal

\{ `type`: `"reroll"`; `roll`: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`; `subset`: `"ones"` \| `"all-failures"`; \}

***

### Type Literal

\{ `type`: `"reroll-one"`; `roll`: `"hit"` \| `"wound"` \| `"save"` \| `"damage"`; \}

"Re-roll one Hit roll": one die of the roll, at the player's pick, across the attack pool —
a failed die no other re-roll already took, or for Damage the lowest roll when it is below the
mean of a fresh roll. The engine prices one such die per crunch (engine.ts `oneRerollDice`).

***

### Type Literal

\{ `type`: `"extra-keyword"`; `keywordRef`: [`WeaponKeywordRef`](../../generated/interfaces/WeaponKeywordRef.md); \}

***

### Type Literal

\{ `type`: `"feel-no-pain"`; `threshold`: `number`; `scope?`: `"all"` \| `"mortal"`; \}

Feel-no-pain: roll one D6 per unsaved wound at `threshold`+, ignoring the
wound on a pass. `scope` controls which wound stream it applies to:
 - `"all"` (default): every unsaved wound (main + mortal).
 - `"mortal"`: mortal-wound stream only (e.g. Death Guard 5+ FNP vs
   mortals). A target may carry both an all-FNP and a mortal-FNP; the
   engine rolls both against mortals.

***

### Type Literal

\{ `type`: `"damage-mod"`; `value`: `number`; \}

***

### Type Literal

\{ `type`: `"attacks-mod"`; `value`: `number`; \}

Additive modifier to the attacker's per-model attack count (A stat).

***

### Type Literal

\{ `type`: `"strength-mod"`; `value`: `number`; \}

Additive modifier to the attacker's Strength stat.

***

### Type Literal

\{ `type`: `"toughness-mod"`; `value`: `number`; \}

Additive modifier to the defender's Toughness stat.

***

### Type Literal

\{ `type`: `"ap-mod"`; `value`: `number`; \}

Additive modifier to the attacker's weapon AP. AP is signed against the
defender's save (negative = more piercing), so a value of `-1` here makes
the weapon one AP more piercing.

***

### Type Literal

\{ `type`: `"stat-set"`; `stat`: `SetStat`; `value`: `number`; \}

Attacker-side: the weapon's A, S, AP or D characteristic becomes `value` before any modifier
applies. AP is signed like the profile (`-2` is AP -2). The attacker's best set wins.

***

### Type Literal

\{ `type`: `"damage-reduction"`; `value`: `number`; \}

Defender-side: subtract `value` from each unsaved damage point (floored at
1 by the engine). Multiple sources do NOT stack in 10e — the largest
reduction wins. A `"to-zero"` reduction is `damage-zeroing` below; a
halving one is not modelled.

***

### Type Literal

\{ `type`: `"damage-zeroing"`; `uses`: `number`; `per`: `"unit"` \| `"model"`; \}

Defender-side: `uses` unsaved attacks have their Damage changed to 0 before it is rolled, from
a pool the unit shares or `uses` for each model. Only the discrete allocation stage reads it;
the expected-value stages ignore it.

***

### Type Literal

\{ `type`: `"invulnerable-save"`; `threshold`: `number`; \}

Defender-side: ability-granted invulnerable save threshold (e.g. a buff
that grants a 4+ invuln). Best (lowest) threshold wins; the engine then
picks the better of `printed Sv after AP/cover` and `effective invuln`
(invuln bypasses both AP and cover).

***

### Type Literal

\{ `type`: `"crit-threshold"`; `roll`: `"hit"` \| `"wound"`; `value`: `number`; \}

Attacker-side: an unmodified roll of `value`+ is a critical hit/wound. Lowest wins.

***

### Type Literal

\{ `type`: `"ignore-modifiers"`; `roll`: `"hit"` \| `"wound"`; \}

Attacker-side: the attacker ignores every negative modifier to this roll (and, for hits, the
benefit of cover). Positive modifiers still apply.

***

### Type Literal

\{ `type`: `"skill-mod"`; `stat`: `"WS"` \| `"BS"`; `value`: `number`; \}

Attacker-side: improve the WS or BS characteristic by `value` (a characteristic change, so not
capped like a hit-roll modifier). The engine floors the characteristic at 2+.

***

### Type Literal

\{ `type`: `"save-characteristic"`; `value`: `number`; \}

Defender-side: the Save characteristic becomes `value`+. Best (lowest) wins.

***

### Type Literal

\{ `type`: `"save-improve"`; `value`: `number`; `best`: `number`; \}

Defender-side: improve the Save characteristic by `value`, but never to better than `best`+.
Applies after any `save-characteristic` and before AP.
