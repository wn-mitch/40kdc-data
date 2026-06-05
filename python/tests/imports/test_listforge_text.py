"""ListForge plain-text adapter unit tests.

ListForge's copy-paste export: a ``name - faction - detachment (N Points)``
first line, mixed-case role sections ending with ``:``, units as
``Name (N pts)`` headers, and indented ``•`` bullets for model groups, wargear,
the ``E: <name>`` enhancement annotation, and the bare ``Warlord`` marker.
These tests pin the parse and the disjointness from the other text matchers.

Python mirror of ``tools/test/import/listforge-text.test.ts``.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.imports import try_import_roster
from wh40kdc.imports.gw import gw_adapter
from wh40kdc.imports.listforge_text import listforge_text_adapter
from wh40kdc.imports.newrecruit_simple import newrecruit_simple_adapter

# Condensed from the reference Chaos Daemons export.
SAMPLE = """all gas no breaks - Chaos Daemons - Daemonic Incursion (1995 Points)


Epic Hero:
Rotigus (250 pts)
  • Gnarlrod
  • Streams of brackish filth


Character:
Great Unclean One (295 pts)
  • Putrid vomit
  • Bileblade
  • Bilesword
  • E: The Endless Gift
  • Warlord

Bloodmaster (65 pts)
  • Blade of blood


Battleline:
Bloodletters (110 pts)
  • Bloodreaper
    • Hellblade
  • Instrument of Chaos
  • Daemonic Icon
  • 9x Bloodletter
    • 9x Hellblade


Beast:
Flesh Hounds (75 pts)
  • Gore Hound
    • Burning maw
    • Collar of Khorne
    • Gore-drenched fangs
  • 4x Flesh Hound
    • 4x Collar of Khorne
    • 4x Gore-drenched fangs
"""


def _by_name(parsed: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {u["raw_name"]: u for u in parsed["units"]}


def _gear(unit: dict[str, Any]) -> dict[str, int]:
    return {w["raw_name"]: w["count"] for w in unit["wargear"]}


class TestMatches:
    def test_recognises_the_listforge_text_export(self) -> None:
        assert listforge_text_adapter.matches(SAMPLE) is True

    def test_rejects_non_string_and_other_text_formats(self) -> None:
        assert listforge_text_adapter.matches({"roster": {}}) is False
        # newrecruit-simple first line ends `- [N pts]`, not `(N Points)`.
        assert (
            listforge_text_adapter.matches(
                "Chaos - Chaos Knights - List - [2000 pts]\n\n"
                "# ++ Army Roster ++ [2000 pts]\nUnit [5 pts]:\n• 1x Model: Gun"
            )
            is False
        )
        # A GW export's first non-blank line is the `++++` fence.
        assert (
            listforge_text_adapter.matches(
                "++++\n+ FACTION KEYWORD: Chaos - Chaos Knights\n++++\n"
                "Unit (5 pts)\n• 1x Gun"
            )
            is False
        )

    def test_requires_bullets_and_refuses_wtc_with_bodies(self) -> None:
        no_bullets = "name - Faction - Detachment (1000 Points)\nUnit (50 pts)"
        assert listforge_text_adapter.matches(no_bullets) is False
        with_lines = (
            "name - Faction - Detachment (1000 Points)\n"
            "Unit (50 pts)\n  • Gun\n1 with Sword"
        )
        assert listforge_text_adapter.matches(with_lines) is False

    def test_stays_disjoint_from_other_text_matchers(self) -> None:
        assert gw_adapter.matches(SAMPLE) is False
        assert newrecruit_simple_adapter.matches(SAMPLE) is False


class TestTryImportRoster:
    def test_auto_detects_and_resolves(self, dataset: Any) -> None:
        result = try_import_roster(SAMPLE, dataset)
        assert result["ok"] is True
        assert result["format"] == "listforge-text"
        assert result["roster"]["faction_id"] == "chaos-daemons"


class TestParse:
    parsed = listforge_text_adapter.parse(SAMPLE)

    def test_reads_header_fields(self) -> None:
        assert self.parsed["name"] == "all gas no breaks"
        assert self.parsed["faction_raw_name"] == "Chaos Daemons"
        assert self.parsed["detachment_raw_name"] == "Daemonic Incursion"
        assert self.parsed["total_reported"] == 1995
        # ListForge reports only the army total — it doubles as the limit.
        assert self.parsed["declared_limit"] == 1995

    def test_captures_units_in_declaration_order(self) -> None:
        assert [u["raw_name"] for u in self.parsed["units"]] == [
            "Rotigus",
            "Great Unclean One",
            "Bloodmaster",
            "Bloodletters",
            "Flesh Hounds",
        ]

    def test_flags_characters_from_epic_hero_and_character_sections(self) -> None:
        flags = {u["raw_name"]: u["is_character"] for u in self.parsed["units"]}
        assert flags["Rotigus"] is True
        assert flags["Great Unclean One"] is True
        assert flags["Bloodmaster"] is True
        assert flags["Bloodletters"] is False
        assert flags["Flesh Hounds"] is False

    def test_reads_enhancement_without_claiming_points(self) -> None:
        guo = _by_name(self.parsed)["Great Unclean One"]
        assert guo["enhancement_raw_name"] == "The Endless Gift"
        assert guo["enhancement_points"] is None
        assert guo["points"] == 295  # displayed points stay as-is
        assert guo["is_warlord"] is True

    def test_derives_model_counts_from_bulleted_model_groups(self) -> None:
        units = _by_name(self.parsed)
        assert units["Bloodletters"]["model_count"] == 10  # Bloodreaper + 9x
        assert units["Flesh Hounds"]["model_count"] == 5  # Gore Hound + 4x
        assert units["Rotigus"]["model_count"] == 1  # wargear-only bullets

    def test_aggregates_squad_wide_wargear(self) -> None:
        gear = _gear(_by_name(self.parsed)["Bloodletters"])
        assert gear["Hellblade"] == 10  # 1 (Bloodreaper's) + 9 (squad line)
        assert gear["Instrument of Chaos"] == 1
        assert gear["Daemonic Icon"] == 1

    def test_sums_total_computed_from_unit_points(self) -> None:
        assert self.parsed["total_computed"] == 250 + 295 + 65 + 110 + 75

    def test_does_not_leak_prose_fields(self) -> None:
        import json

        blob = json.dumps(self.parsed)
        assert "description" not in blob
        assert "rules" not in blob
