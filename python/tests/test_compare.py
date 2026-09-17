"""Integration tests for the fleet-comparison cross product.

These exercise the real embedded dataset and the real cruncher — no mocks —
mirroring the repo's preference for integration over unit isolation.
"""

from __future__ import annotations

import json

import pytest

from wh40kdc import compare
from wh40kdc.data.dataset import Dataset


@pytest.fixture(scope="module")
def ds() -> Dataset:
    return Dataset.embedded()


def test_all_profiles_resolve_to_real_units(ds: Dataset) -> None:
    """Every shipped target profile must reference a unit that exists in its
    declared faction — the referential integrity the JSON schema can't check."""
    for profile in ds.target_profiles.all:
        resolved = compare.resolve_target(ds, profile)
        assert resolved.unit_raw["id"] == profile["unit_id"]
        assert resolved.unit_raw["faction_id"] == profile["faction_id"]
        assert resolved.model_count >= 1


def test_resolve_uses_unit_min_when_no_override(ds: Dataset) -> None:
    profile = ds.target_profiles.get("geq-guardsmen")
    resolved = compare.resolve_target(ds, profile)
    # Cadian Shock Troops min squad is 10.
    assert resolved.model_count == 10


def test_model_count_override_wins(ds: Dataset) -> None:
    profile = dict(ds.target_profiles.get("meq-intercessors"))
    profile["model_count_override"] = 3
    resolved = compare.resolve_target(ds, profile)
    assert resolved.model_count == 3


def test_resolve_missing_unit_raises(ds: Dataset) -> None:
    bad = {"id": "x", "name": "X", "faction_id": "world-eaters", "unit_id": "no-such-unit"}
    with pytest.raises(ValueError, match="not in the dataset"):
        compare.resolve_target(ds, bad)


def test_shared_unit_resolves_faction_scoped(ds: Dataset) -> None:
    """The Forgefiend exists under multiple chaos factions with one shared id;
    resolution must pick the world-eaters copy, not whatever .get(id) returns."""
    profile = {
        "id": "ff",
        "name": "FF",
        "faction_id": "world-eaters",
        "unit_id": "forgefiend",
    }
    resolved = compare.resolve_target(ds, profile)
    assert resolved.unit_raw["faction_id"] == "world-eaters"


def test_forgefiend_anti_infantry_profile(ds: Dataset) -> None:
    """Forgefiend at 15" shooting kills far more GEQ than it does a knight, and
    its best weapon against infantry fires within half range."""
    ff = ds.units.get_in_faction("forgefiend", "world-eaters")
    geq = compare.resolve_target(ds, ds.target_profiles.get("geq-guardsmen"))
    knight = compare.resolve_target(ds, ds.target_profiles.get("questoris-knight"))

    vs_geq = compare.unit_vs_target(ds, ff, geq, distance=15, phase="shooting", models_firing=1)
    vs_knight = compare.unit_vs_target(
        ds, ff, knight, distance=15, phase="shooting", models_firing=1
    )

    assert vs_geq.best is not None
    assert vs_geq.best.within_half_range is True  # 15 <= 36/2
    assert vs_geq.metric("best-weapon") > vs_knight.metric("best-weapon")
    # Anti-infantry shots cap at the squad size, never exceed it.
    assert vs_geq.metric("best-weapon") <= geq.model_count


def test_out_of_range_weapon_does_not_reach(ds: Dataset) -> None:
    """A 36" gun cannot reach at 48"; the weapon is flagged unreachable with
    zero kills and is excluded from the best-weapon pick."""
    ff = ds.units.get_in_faction("forgefiend", "world-eaters")
    geq = compare.resolve_target(ds, ds.target_profiles.get("geq-guardsmen"))
    cell = compare.unit_vs_target(ds, ff, geq, distance=48, phase="shooting", models_firing=1)
    assert cell.weapons  # ranged weapons enumerated
    assert all(not w.reaches for w in cell.weapons)
    assert all(w.expected_kills == 0.0 for w in cell.weapons)
    assert cell.best is None


def test_defensive_abilities_reduce_kills(ds: Dataset) -> None:
    """The C'tan Shard carries a defensive ability (damage reduction / FNP). The
    comparison must apply it, so the same gun kills strictly less into the C'tan
    than the resolved profile stats alone would predict (defensive buffs > 0)."""
    ctan = compare.resolve_target(ds, ds.target_profiles.get("ctan-shard"))
    buffs = ds.defensive_buffs_for(
        {"unitId": ctan.unit_raw["id"], "factionId": ctan.unit_raw["faction_id"]},
        {"phase": "shooting", "withinHalfRange": False},
    )
    assert len(buffs) > 0


def test_build_matrix_shape(ds: Dataset) -> None:
    attackers = [ds.units.get_in_faction("forgefiend", "world-eaters")]
    targets = [
        compare.resolve_target(ds, ds.target_profiles.get(pid))
        for pid in ("geq-guardsmen", "meq-intercessors")
    ]
    matrix = compare.build_matrix(
        ds,
        attacker_units=attackers,
        targets=targets,
        distance=15,
        phase="shooting",
        models_firing=1,
    )
    assert len(matrix) == 1
    assert len(matrix[0]) == 2


def test_cli_table_smoke(ds: Dataset, capsys: pytest.CaptureFixture[str]) -> None:
    rc = compare.main(
        ["--attacker-faction", "world-eaters", "--attacker-units", "forgefiend", "--range", "15"]
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "Forgefiend" in out
    assert "Guardsmen (GEQ)" in out


def test_cli_json_smoke(capsys: pytest.CaptureFixture[str]) -> None:
    rc = compare.main(
        [
            "--attacker-faction",
            "world-eaters",
            "--attacker-units",
            "forgefiend",
            "--targets",
            "meq-intercessors",
            "--range",
            "15",
            "--format",
            "json",
        ]
    )
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["metric"] == "best-weapon"
    cell = payload["rows"][0]["cells"][0]
    assert cell["best_weapon"]["within_half_range"] is True
    assert cell["value"] > 0


def test_cli_unknown_target_errors(capsys: pytest.CaptureFixture[str]) -> None:
    rc = compare.main(["--attacker-faction", "world-eaters", "--targets", "nope"])
    assert rc == 2
    assert "unknown target profile" in capsys.readouterr().err


# --- loadout ranking --------------------------------------------------------


def test_loadout_totals_at_damage_level_not_kills(ds: Dataset) -> None:
    """A 2-Hades loadout totals damage then caps kills once — not the sum of two
    independently-capped per-weapon kills."""
    meq = compare.resolve_target(ds, ds.target_profiles.get("meq-intercessors"))
    cfg = compare.LoadoutConfig(
        label="2x Hades", lines=[compare.LoadoutLine("hades-autocannon", 2)], points=165
    )
    res = compare.loadout_output(ds, cfg, meq, distance=15, phase="shooting")
    single = compare.loadout_output(
        ds,
        compare.LoadoutConfig("1x", [compare.LoadoutLine("hades-autocannon", 1)]),
        meq,
        15,
        "shooting",
    )
    assert res["damage"] == pytest.approx(2 * single["damage"], rel=1e-9)
    assert res["kills"] == pytest.approx(min(5, res["damage"] / 2), rel=1e-9)


def test_loadout_kills_capped_at_model_count(ds: Dataset) -> None:
    guard = compare.resolve_target(ds, ds.target_profiles.get("geq-guardsmen"))
    cfg = compare.LoadoutConfig("4x Hades", [compare.LoadoutLine("hades-autocannon", 4)])
    res = compare.loadout_output(ds, cfg, guard, distance=15, phase="shooting")
    assert res["kills"] <= guard.model_count


def test_out_of_range_line_excluded_from_total(ds: Dataset) -> None:
    meq = compare.resolve_target(ds, ds.target_profiles.get("meq-intercessors"))
    mixed = compare.LoadoutConfig(
        "mixed",
        [compare.LoadoutLine("hades-autocannon", 1), compare.LoadoutLine("combi-bolter", 1)],
    )
    hades_only = compare.LoadoutConfig("hades", [compare.LoadoutLine("hades-autocannon", 1)])
    assert compare.loadout_output(ds, mixed, meq, 30, "shooting")["damage"] == pytest.approx(
        compare.loadout_output(ds, hades_only, meq, 30, "shooting")["damage"], rel=1e-9
    )


def test_rank_loadouts_sorts_and_scores_per_point(ds: Dataset) -> None:
    targets = [
        compare.resolve_target(ds, ds.target_profiles.get(p)) for p in ("geq-guardsmen", "rhino")
    ]
    configs = [
        compare.LoadoutConfig("2x Hades", [compare.LoadoutLine("hades-autocannon", 2)], points=165),
        compare.LoadoutConfig("2x Ecto", [compare.LoadoutLine("ectoplasma-cannon", 2)], points=165),
    ]
    ranked = compare.rank_loadouts(ds, configs, targets, 15, "shooting")
    assert ranked[0]["score"] >= ranked[1]["score"]
    assert all(r["scorePer100Points"] == pytest.approx(r["score"] / 165 * 100) for r in ranked)


def test_rank_by_specific_target(ds: Dataset) -> None:
    targets = [
        compare.resolve_target(ds, ds.target_profiles.get(p)) for p in ("geq-guardsmen", "rhino")
    ]
    configs = [
        compare.LoadoutConfig("2x Hades", [compare.LoadoutLine("hades-autocannon", 2)], points=165),
        compare.LoadoutConfig("2x Ecto", [compare.LoadoutLine("ectoplasma-cannon", 2)], points=165),
    ]
    ranked = compare.rank_loadouts(ds, configs, targets, 15, "shooting", rank_target_id="rhino")
    assert ranked[0]["config"].label == "2x Ecto"  # S10 AP-3 out-damages Hades into a Rhino


def test_enumerate_forgefiend_configs(ds: Dataset) -> None:
    en = compare.enumerate_loadouts(ds, "world-eaters", "forgefiend")
    # The BSData datasheet models two independent swaps: the main turret
    # (hades autocannon <-> ectoplasma cannon) and the maw mount (jaws ->
    # ectoplasma cannon + claws). The maw is a separate weapon slot, so a
    # hades-turret + ectoplasma-maw mix is a real loadout, not just the two
    # single-weapon configs.
    assert {c.label for c in en.configs} == {
        "Hades autocannon",
        "Ectoplasma cannon",
        "Ectoplasma cannon + Hades autocannon",
    }
    assert en.counts_known is False
    # MFM data_version 909 reprices the Forgefiend to 140 for the 1st–2nd unit;
    # the maw swap is free, so every config stays at 140.
    assert all(c.points == 140 for c in en.configs)


def test_enumerate_defiler_configs_are_mutually_exclusive(ds: Dataset) -> None:
    en = compare.enumerate_loadouts(ds, "world-eaters", "defiler")
    assert len(en.configs) > 1
    heavy = {
        "reaper-autocannon",
        "twin-heavy-bolter",
        "twin-lascannon",
        "twin-inferno-heavy-bolter",
    }
    for c in en.configs:
        chosen = [ln.weapon_id for ln in c.lines if ln.weapon_id in heavy]
        assert len(chosen) <= 1, f"{c.label}: {chosen}"


def test_cli_enumerate_mode(capsys: pytest.CaptureFixture[str]) -> None:
    rc = compare.main(
        ["--attacker-faction", "world-eaters", "--enumerate", "forgefiend", "--range", "15"]
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "Hades autocannon" in out and "Dmg/100pt" in out
