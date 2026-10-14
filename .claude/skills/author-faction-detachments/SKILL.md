---
name: author-faction-detachments
description: >-
  Author 11e faction-pack detachment metadata + new detachments with structured
  ability DSL for a target faction, then verify across TS/Rust/Python. Use when a
  faction pack PDF (in _private/) needs its detachments backfilled with
  detachment_points/force_dispositions, its new pack detachments added as core
  entities + DSL, redefined ports reconciled, and structured Rules Updates applied.
argument-hint: <faction-id>   e.g. thousand-sons, chaos-daemons, world-eaters
---

# Author faction-pack detachments + ability DSL

Repeatable process for bringing one faction's detachments to the worked pattern
(see `data/core/world-eaters/` + `data/enrichment/world-eaters/`). Target faction
is the argument (`$1`, a kebab `faction_id`). The pack PDF lives in `_private/`.

The PDF read + DSL authoring need judgment — this skill is the checklist and the
conventions, not a one-shot script. Author data via small Python scripts (bulk,
coordinated multi-file JSON edits — no CLI tool covers this), never copy GW prose.

## 0. Scope

In scope: **detachment / enhancement / stratagem** items only. Excluded:
unit/datasheet abilities, army rules, FAQ/Legends. Don't re-author DSL for
existing detachments that the pack merely reprints — backfill them only.

## 1. Extract the pack

```bash
pdftotext -layout _private/<pack>.pdf /tmp/<faction>.txt && wc -l /tmp/<faction>.txt
```
Read the **Contents / What's New** list and each detachment block. For each
detachment, record: rule, enhancements, stratagems, CP costs, WHEN→phase/turn,
and any `UNIQUE: <TAG>` line or "has the <X> tag" sentence (→ detachment `tags`).
Then read the **Rules Updates** section.

## 2. Classify each detachment

Cross-reference the GW Community DP/force-disposition values against the existing
data (`data/core/<faction>/detachments.json`):

- **Backfill** (exists in data, pack reprints it): set `detachment_points` (1–3)
  + `force_dispositions` (+ `tags`). Diff the existing enh/strat against the PDF —
  if they already match (common), backfill only.
- **New** (no existing id): author as a full core entity + DSL. DP-1 detachments
  are usually the compact shape (1 rule / 2 enh / 3 strat) — but **the PDF is
  authority**; some are 1 enh/4 strat or 4 enh/6 strat. Count from the PDF.
- **Reconcile** (exists but pack redefines into a different/compact shape, e.g.
  WE Vessels of Wrath, DG Flyblown Host, CSM Cabal of Chaos): trim the
  `enhancement_ids`/`stratagem_ids` to the pack's set, set `detachment_rule_id`,
  set DP/disposition/tags, **remove the contradicted 10e-port orphan enh/strat
  objects** (and their phase-mappings) — but if an "orphan" reappears under a
  different pack detachment, **reassign** it (update `detachment_id`) instead of
  deleting (e.g. DG `rejuvenating-swarm` moved Flyblown→Paragons).

`force-disposition-id` enum: `take-and-hold | disruption | purge-the-foe |
priority-assets | reconnaissance`.

## 3. Author the data (small Python scripts)

Mirror the entity shapes already in the faction's files. Key fields:

- **detachment**: `detachment_points`, `force_dispositions: []`, optional `tags`
  (UNIQUE groups), `granted_keywords` (construction keywords like Battleline→X —
  *not* combat keywords), `detachment_rule_id`, `enhancement_ids`, `stratagem_ids`.
- **enhancement**: `detachment_id`, `cost` (provisional; `points_provisional:true`),
  `keyword_restrictions`, `ability_id` (= the id), `upgrade_tag:true` for
  non-character "UPGRADE" enhancements, `max_targets`.
- **stratagem**: `category:"detachment"`, `detachment_id`, `cp_cost` (0–4),
  `phases` (from WHEN), `player_turn` (your-turn/opponent-turn/either),
  `timing`, `ability_id`. Omit `type` for newly introduced detachments
  (the pack doesn't label them battle-tactic/ploy/etc.).

### Ability DSL (`data/enrichment/<faction>/abilities.json`)

Required: `ability_id, name, authored_by:"40kdc-community", game_version,
ability_type (detachment|enhancement|stratagem), behavior (passive|activated|
reactive|aura), effect, scope`. Also set `version:"2025-q3", supersedes:null,
`unit_ids:[], faction_id, detachment_id`, and `applies_to` as the static,
human-curated roster-highlighting predicate (`all_of`, `any_of`, `none_of`,
and/or `not_all_of`; `null`/absent means no highlight, `{}` matches all).
`applies_to` is not a runtime target.

Effect/condition/scope vocabulary is closed and documented in
`schemas/enrichment/ability-dsl/{effect,condition,scope}.schema.json`. Do not
invent keys in `modifier` or condition `parameters`, and do not emit retired
aliases. Runtime recipients use typed unit references and `unit-filter`:
`this-model`/`model-in-this-unit` are model references; actual attached
membership uses `level:"model"`, `member_of`, and
`attachment_role:"bodyguard"|"leader"`. A reviewed source-family
`bodyguard_only` parameter may remain in family semantics, but deterministic
lowering emits that typed filter.

Selectors use one canonical contract: `filter`, optional inclusive `count`
bounds, optional per-target `limit`, `bind_as`, and event-dependent
`eligibility`. Use `range` with `range-ref` for reach and `weapon-scope` with
catalog-backed keyword references for weapon restrictions; do not use
`scope.range_inches` or flattened weapon fields. Ordinary predicates use
`matches`; preserve parameterized historical/correlated predicates instead of
replacing them with unrelated atoms. Board-dependent tests retain explicit
unknown/permissive behavior when no board state is available.

Stance options require stable `id` plus display `name`. Cross-record links are
`{ability_id, option_id}` and resolve within the containing ability under the
faction-local then shared-core policy; never resolve by display label or slug.
Parent usage allowances and local ability-part triggers are independent.

Find a precedent before proposing a shape:
```bash
# representative effect for a concept, across all factions
python3 - <<'PY'
import json,glob
for f in glob.glob('data/enrichment/*/abilities.json'):
    for a in json.load(open(f)):
        s=json.dumps(a.get('effect'))
        if '"feel-no-pain"' in s and 'mortal' in s:   # ← edit the predicate
            print(f, a['ability_id']); print(json.dumps(a['effect'],indent=1)); raise SystemExit
PY
```

Established conventions (reuse them for parity-friendly output):
- heal → typed `heal`/`ability-grant` shape already present in the schema; preserve its
  target and amount fields.
- FNP vs mortals → `feel-no-pain` with the schema's typed threshold and scope.
- dice→MW → `mortal-wounds` with the schema's dice, threshold/comparison, and
  per-success fields (or `dice-gated` when the roll gates the branch).
- unit keyword → `keyword-grant` with `keywords`; weapon abilities →
  `weapon-ability-grant` with catalog-backed `weapon-keyword-ref` entries.
- grant a core ability → `ability-grant` naming the existing ability entity.
- grant BATTLELINE etc. for construction → detachment `granted_keywords`, not DSL.
- re-roll → `re-roll` with its required `roll` and `subset` fields.
- "secure objective" → the existing typed objective/designation shape; do not invent
  a keyword grant.

### Phase-mappings (`data/enrichment/<faction>/phase-mappings.json`)

One per new ability: `{source_id, source_type:"ability", phases:[...],
game_version, authored_by}`. Skip if the entity already has a mapping.

## 4. Rules Updates — structured only

Apply a Rules Update **only when it changes a field we model**: stratagem
`cp_cost`, `phases`, `player_turn`, `timing`, `target_restrictions`. Pure prose /
range tweaks ("9″→8″", effect rewrites) have no structured slot — skip them.

## 5. ID hygiene (the gotcha)

Shared-chassis abilities resolve **first-wins / faction-blind** on a global
`ability_id` — author each faction's own copy in its own files; don't trust
`ds.abilities.get(id)` when spot-checking. When a new id collides with an
existing entity (GW reuses names across detachments), give the new one a
detachment-qualified id (e.g. `prey-on-the-weak-raiders`,
`undying-hatred-devotees`). Entity ids must be unique within a collection.

## 6. Validate + ref-check (per faction, before parity)

```bash
cd tools && npm run validate    # 0 failures
```
```bash
python3 - "$1" <<'PY'
import json,sys; f=sys.argv[1]
d=json.load(open(f"data/core/{f}/detachments.json")); enh=json.load(open(f"data/core/{f}/enhancements.json"))
st=json.load(open(f"data/core/{f}/stratagems.json")); ab={a['ability_id'] for a in json.load(open(f"data/enrichment/{f}/abilities.json"))}
ei={e['id'] for e in enh}; si={s['id'] for s in st}; p=[]
for x in d:
    if x['detachment_rule_id'] and x['detachment_rule_id'] not in ab: p.append(f"det {x['id']} rule {x['detachment_rule_id']}")
    p += [f"det {x['id']} enh {e}" for e in x['enhancement_ids'] if e not in ei]
    p += [f"det {x['id']} strat {s}" for s in x['stratagem_ids'] if s not in si]
p += [f"enh {e['id']}->{e['ability_id']}" for e in enh if e['ability_id'] and e['ability_id'] not in ab]
p += [f"strat {s['id']}->{s['ability_id']}" for s in st if s['ability_id'] and s['ability_id'] not in ab]
for lbl,c in (("det",d),("enh",enh),("strat",st)):
    ids=[x['id'] for x in c]; dup=[i for i in set(ids) if ids.count(i)>1]
    if dup: p.append(f"DUP {lbl} {dup}")
print(f"[{f}] dets={len(d)} dp_set={sum(1 for x in d if x['detachment_points'])} refs:", p or "OK")
PY
```

## 7. Tri-language parity (once, after all target factions authored)

```bash
cd tools
npm run codegen:data && npm run gen:conformance && npm test       # TS oracle + suite
cd .. && cargo run -p xtask -- bundle-data && cargo test -p wh40kdc   # Rust reproduces
python3 python/codegen/sync_bundle.py    # embedded data bundle
python3 python/codegen/sync_spec.py      # _spec.py (SPEC_VERSION mirror) — easy to forget
python3 python/codegen/gen_typeddicts.py # _types.py (only drifts if schemas changed)
cd python && source .venv/bin/activate && python -m pytest tests -q  # Python reproduces
cd .. && npm --prefix tools run audit:coverage                       # refresh coverage snapshot
```

If any file under `conformance/` changed (e.g. `effect-translation/cases.json`,
roster goldens), **bump `conformance/SPEC_VERSION` by 1** — the changed golden is
only accepted once an impl other than TS reproduces it (Python reproduces
effect-translation; Rust reproduces roster/cruncher/linked-api). If no golden
changed (e.g. a pure id-dedup with no DSL), don't bump.

**Bumping SPEC_VERSION is not just the file edit.** It mirrors into a generated
artifact, `python/src/wh40kdc/_spec.py`, via `sync_spec.py` (NOT `sync_bundle.py`).
CI fails two ways if you skip it: the parity runner's init handshake rejects the
corpus's `spec_version` (`runner=N, request=N+1`), and the "generated Python
artifacts up to date" check flags the stale file. Always run `sync_spec.py` after
a bump and commit `_spec.py` with the corpus.

## 8. Commit

Conventional commit, no scope. Commit data + regenerated Rust/Python bundles +
goldens + `SPEC_VERSION` + coverage snapshot together. The TS bundle
(`tools/src/data/bundle.generated.ts`) is gitignored — don't try to commit it.
