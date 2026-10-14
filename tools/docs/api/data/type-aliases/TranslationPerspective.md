[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / TranslationPerspective

# Type Alias: TranslationPerspective

> **TranslationPerspective** = `"attacker"` \| `"target"`

Defined in: [cruncher/from-dsl.ts:104](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L104)

Whose perspective the translation runs from.

- `"attacker"`: the buffed unit is *firing*. `target: "unit"/"self"` etc.
  become attacker-side mods (re-rolls, hit/wound mods, A/S shifts, granted
  keywords). `target: "defender"` is silently dropped — that's incoming
  penalty math relevant when the buffed unit is the *target*, surfaced via
  the `"target"` perspective instead.

- `"target"`: the buffed unit is *being shot at*. Defensive mods on the
  buffed unit (`stat-modifier T`, `stat-modifier Sv`, `feel-no-pain`,
  `roll-modifier save`) become defender-side buffs. Conversely, attacker-
  only mods (re-rolls, hit/wound mods, A/S shifts) drop silently because
  they describe what the buffed unit does when *attacking*.

The bs-modifier effect (a -1 to incoming hit rolls, e.g. Benefit of Cover)
becomes a `hit-mod` buff under target perspective so it stacks correctly
with attacker-side modifiers in the resolver's ±1 cap.
