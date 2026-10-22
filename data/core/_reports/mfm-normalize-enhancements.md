# MFM enhancement RAW-name normalization

Renames the authored enhancement name + id to the RAW GW form (keep the
` (Upgrade)`/` (Aura)`/` (Psychic)` tag) and rewrites detachment
`enhancement_ids` references. Import-correct: `normalizeName` keeps parens,
so a stripped repo name never matches an imported roster line.

- **Id renames (distinct):** 0
- **Name changes (rows):** 0
- **Detachment refs rewritten:** 0
- **Ambiguous bases skipped:** 0

