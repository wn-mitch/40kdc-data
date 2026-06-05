"""NewRecruit "simple" text adapter edge-case unit tests.

Ports the "edge cases" block from
``tools/test/import/newrecruit-simple.test.ts``:

1. Points brackets may carry comma-separated faction resources
   (``[4485pts, 29Cabal Points]``) — the tail is discarded.
2. ``matches()`` accepts exports that omit the ``# ++ Army Roster ++`` line but
   carry a ``## Section`` heading.
3. A unit line directly after Configuration ends the configuration block.
"""

from __future__ import annotations

from wh40kdc.imports.newrecruit_simple import newrecruit_simple_adapter


def test_parses_points_brackets_with_comma_separated_faction_resources() -> None:
    cabal = (
        "Chaos - Thousand Sons - Tester - [4485pts, 29Cabal Points]\n"
        "\n"
        "# ++ Army Roster ++ [4485pts, 29Cabal Points]\n"
        "## Epic Hero [895pts, 13Cabal Points]\n"
        "Ahriman [140pts, 3Cabal Points]: Black Staff of Ahriman, Inferno bolt pistol\n"
    )
    assert newrecruit_simple_adapter.matches(cabal) is True
    parsed = newrecruit_simple_adapter.parse(cabal)
    assert parsed["declared_limit"] == 4485
    assert parsed["total_reported"] == 4485
    assert len(parsed["units"]) == 1
    assert parsed["units"][0]["raw_name"] == "Ahriman"
    assert parsed["units"][0]["points"] == 140


def test_matches_exports_that_omit_army_roster_line_but_carry_sections() -> None:
    headerless = (
        "Chaos - World Eaters - Proxy List - [2000pts]\n"
        "\n"
        "## Epic Hero [675pts]\n"
        "Angron [435pts]: Samni'arius and Spinegrinder, Warlord\n"
    )
    assert newrecruit_simple_adapter.matches(headerless) is True
    parsed = newrecruit_simple_adapter.parse(headerless)
    assert parsed["faction_raw_name"] == "World Eaters"
    assert parsed["total_reported"] is None
    assert len(parsed["units"]) == 1
    assert parsed["units"][0]["is_warlord"] is True


def test_unit_line_directly_after_configuration_ends_that_section() -> None:
    no_units_header = (
        "Xenos - T'au Empire - Base Tau - [2000pts]\n"
        "\n"
        "# ++ Army Roster ++ [2000pts]\n"
        "## Configuration\n"
        "Battle Size: Strike Force (2000 Point limit)\n"
        "Detachment: Auxiliary Cadre\n"
        "Show/Hide Options: Legends are visible\n"
        "\n"
        "Broadside Battlesuits [90pts]:\n"
        "• 1x Broadside Shas'vre: Crushing bulk, 2x Shield Drone, Heavy rail rifle\n"
        "Broadside Battlesuits [90pts]:\n"
        "• 1x Broadside Shas'vre: Crushing bulk, 2x Shield Drone, Heavy rail rifle\n"
    )
    parsed = newrecruit_simple_adapter.parse(no_units_header)
    assert parsed["detachment_raw_name"] == "Auxiliary Cadre"
    assert len(parsed["units"]) == 2
    assert parsed["units"][0]["raw_name"] == "Broadside Battlesuits"
    assert parsed["units"][0]["model_count"] == 1
    gear = {w["raw_name"]: w["count"] for w in parsed["units"][0]["wargear"]}
    assert gear["Shield Drone"] == 2
    assert gear["Heavy rail rifle"] == 1
