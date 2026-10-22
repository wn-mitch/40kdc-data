# MFM enhancement RAW-name normalization

Renames the authored enhancement name + id to the RAW GW form (keep the
` (Upgrade)`/` (Aura)`/` (Psychic)` tag) and rewrites detachment
`enhancement_ids` references. Import-correct: `normalizeName` keeps parens,
so a stripped repo name never matches an imported roster line.

- **Id renames (distinct):** 1
- **Name changes (rows):** 1
- **Detachment refs rewritten:** 1
- **Ambiguous bases skipped:** 0

## Id renames (share-registry alias set)

| old | new |
|---|---|
| `nightforged-battery-upgarde-darkflight-pursuit-dark-angels` | `nightforged-battery-upgrade-darkflight-pursuit-dark-angels` |

