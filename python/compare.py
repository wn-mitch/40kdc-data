"""
Damage comparison: WE Forgefiend vs War Dog Brigand vs WE Defiler
Outputs Markdown. All targets assumed in cover (11th ed: -1 to hit roll).

Usage:
    uv run python compare.py            # print to stdout
    uv run python compare.py > out.md   # write to file
"""

import itertools
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent / "src"))

from wh40kdc.cruncher import crunch
from wh40kdc.data.dataset import Dataset

ROOT = pathlib.Path(__file__).parent.parent

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------

def _load(faction, file):
    path = ROOT / "data" / "core" / faction / file
    return {e["id"]: e for e in json.loads(path.read_text())}

we_weapons = _load("world-eaters", "weapons.json")
ck_weapons = _load("chaos-knights", "weapons.json")
ds = Dataset.embedded()  # keyword-behavior resolver

# ---------------------------------------------------------------------------
# Buff presets
# ---------------------------------------------------------------------------

COVER = {
    "source": {"kind": "manual", "label": "cover"},
    "applicableWhen": {},
    "contribution": {"type": "cover"},
}
IGNORES_CV = {
    "source": {"kind": "manual", "label": "ignores-cover"},
    "contribution": {
        "type": "extra-keyword",
        "keywordRef": {"keyword_id": "ignores-cover"},
    },
}
FO_REROLL = {
    "source": {"kind": "ability", "abilityId": "furious-onslaught", "abilityKind": "unit"},
    "applicableWhen": {"maxRangeInches": 18},
    "contribution": {"type": "reroll", "roll": "hit", "subset": "all-failures"},
}

# ---------------------------------------------------------------------------
# Synthetic targets
# ---------------------------------------------------------------------------

def _target(label, T, W, Sv, invuln=None, keywords=None):
    profile = {"name": label, "T": T, "W": W, "Sv": Sv}
    if invuln:
        profile["invuln_sv"] = invuln
    return {
        "id": label.lower().replace(" ", "-"),
        "name": label,
        "profiles": [profile],
        "keywords": keywords or [],
        "faction_keywords": [],
    }

TARGETS = [
    _target("GEQ",   T=3,  W=1,  Sv=5, keywords=["Infantry"]),
    _target("MEQ",   T=4,  W=2,  Sv=3, keywords=["Infantry", "Adeptus Astartes"]),
    _target("TEQ",   T=5,  W=3,  Sv=2, invuln=4, keywords=["Infantry", "Terminator"]),
    _target("Rhino", T=9,  W=10, Sv=3, keywords=["Vehicle"]),
    _target("T10V",  T=10, W=12, Sv=3, keywords=["Vehicle"]),
]
TARGET_LABELS = [t["name"] for t in TARGETS]

# ---------------------------------------------------------------------------
# Cruncher helper
# ---------------------------------------------------------------------------

def shoot(weapon, unit, buffs, dist):
    result = crunch(
        {
            "attacker": {"weapon": weapon, "profileIndex": 0},
            "target":   {"unit": unit,    "profileIndex": 0},
            "modelsFiring": 1,
            "buffs": buffs,
            "context": {"phase": "shooting", "distanceInches": dist},
        },
        ds,
    )
    return next(s["expected"] for s in result["stages"] if s["name"] == "after-fnp")


def row_damage(weapons_with_count, buffs, dist):
    per_weapon = []
    totals = [0.0] * len(TARGETS)
    for weapon, count in weapons_with_count:
        name = weapon["name"] + (f" ×{count}" if count > 1 else "")
        dmgs = [shoot(weapon, t, buffs, dist) * count for t in TARGETS]
        for i, d in enumerate(dmgs):
            totals[i] += d
        per_weapon.append((name, dmgs))
    return per_weapon, totals


# ===========================================================================
# Collect all rows into one flat list, then rank by MEQ
# ===========================================================================

all_rows = []  # (label, totals_list)

# ── Forgefiend ──────────────────────────────────────────────────────────────
FF_LOADOUTS = [
    ("FF-A 2×Hades",           [(we_weapons["hades-autocannon"], 2)]),
    ("FF-B 1×Ecto+2×Hades",    [(we_weapons["ectoplasma-cannon"], 1), (we_weapons["hades-autocannon"], 2)]),
    ("FF-C 3×Ecto",            [(we_weapons["ectoplasma-cannon"], 3)]),
]
FF_SCENARIOS = [
    ("cover no strat >18\"",   [COVER],                        30),
    ("cover + AC (1CP)",       [COVER, IGNORES_CV],            30),
    ("cover + AC + FO <18\"",  [COVER, IGNORES_CV, FO_REROLL], 12),
]

for loadout_label, weapons in FF_LOADOUTS:
    for sc_label, buffs, dist in FF_SCENARIOS:
        _, tots = row_damage(weapons, buffs, dist)
        all_rows.append((f"Forgefiend 165pts — {loadout_label} — {sc_label}", tots))

# ── Brigand ──────────────────────────────────────────────────────────────────
WDB_LOADOUTS = [
    ("WDB-A Chain+Spear+Stubber", [
        (ck_weapons["avenger-chaincannon"],    1),
        (ck_weapons["daemonbreath-spear"],     1),
        (ck_weapons["diabolus-heavy-stubber"], 1),
    ]),
    ("WDB-B Chain+Spear+Launcher", [
        (ck_weapons["avenger-chaincannon"],  1),
        (ck_weapons["daemonbreath-spear"],   1),
        (ck_weapons["havoc-multi-launcher"], 1),
    ]),
]
WDB_SCENARIOS = [
    ("OFF obj",  [COVER],             15),
    ("ON obj",   [COVER, IGNORES_CV], 15),
]

for loadout_label, weapons in WDB_LOADOUTS:
    for sc_label, buffs, dist in WDB_SCENARIOS:
        _, tots = row_damage(weapons, buffs, dist)
        all_rows.append((f"Brigand 140pts — {loadout_label} — {sc_label}", tots))

# ── WE Defiler (all 36 permutations) ─────────────────────────────────────────
SLOT_A = [("Hades-BC", we_weapons["hades-battle-cannon"]),    ("Ecto-D",  we_weapons["ectoplasma-destructor"])]
SLOT_B = [("Excru",    we_weapons["excruciator-cannon"]),     ("Magma",   we_weapons["magma-cutters"])]
SLOT_C = [("Flamer",   we_weapons["heavy-baleflamer"]),       ("Las",     we_weapons["hades-lascannon"]),        ("Reaper", we_weapons["heavy-reaper-autocannon"])]
SLOT_D = [("Missile",  we_weapons["heavy-missile-launcher"]), ("Las",     we_weapons["hades-lascannon"]),        ("Reaper", we_weapons["heavy-reaper-autocannon"])]

for (al, aw), (bl, bw), (cl, cw), (dl, dw) in itertools.product(SLOT_A, SLOT_B, SLOT_C, SLOT_D):
    _, tots = row_damage([(aw, 1), (bw, 1), (cw, 1), (dw, 1)], [COVER], 30)
    all_rows.append((f"Defiler 250pts — {al}/{bl}/{cl}/{dl} — cover", tots))

# ── Rank and render ───────────────────────────────────────────────────────────
meq_i = TARGET_LABELS.index("MEQ")
all_rows.sort(key=lambda r: r[1][meq_i], reverse=True)

out = []
out.append("# WE Forgefiend vs War Dog Brigand vs WE Defiler — Damage Comparison")
out.append("")
out.append("> All targets **in cover** (11th ed: −1 to hit). Damage = wounds after FNP. Sorted by MEQ.")
out.append("> Points provisional where noted. FO reroll at dist <18\". Defiler slots: A=main cannon B=secondary C=baleflamer-slot D=missile-slot.")
out.append("")
out.append("Targets: GEQ T3/5+  ·  MEQ T4/3+  ·  TEQ T5/2+/4++  ·  Rhino T9/3+  ·  T10V T10/3+")
out.append("")
out.append("| Unit / Loadout / Scenario | GEQ | MEQ | TEQ | Rhino | T10V |")
out.append("|:---|---:|---:|---:|---:|---:|")
for label, tots in all_rows:
    out.append("| " + label + " | " + " | ".join(f"{d:.2f}" for d in tots) + " |")

print("\n".join(out))
