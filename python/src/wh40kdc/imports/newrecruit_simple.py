"""NewRecruit "simple" markdown-ish text adapter.

Shape::

    <breadcrumb> - <faction> - <list name> - [N pts]

    # ++ Army Roster ++ [N pts]
    ## Configuration
    Battle Size: <Label>
    Detachment: <Name>

    ## <Section> [N pts]
    <Unit> [N pts]: <wargear>
    <Unit> [N pts]:
    • <count>x <ModelType>[ [N pts]]: <wargear>

Enhancements are inlined in the wargear list as ``<Name> [N pts]`` — the only
wargear token wearing a ``[…]`` pts suffix. ``Warlord`` and the detachment
"<X> Character" keyword are also stripped from the list and set as flags.
Per-model-type breakdowns under ``•`` lines are collapsed onto the parent
unit.

Python mirror of ``tools/src/import/newrecruit-simple.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.imports.adapter import FormatAdapter
from wh40kdc.imports.newrecruit_text import classify_wargear_list, split_wargear_list

# Point brackets may carry comma-separated faction resources after the pts
# figure (e.g. `[4485pts, 29Cabal Points]`); the tail is recognized and
# discarded — only the pts figure is consumed.
_FIRST_LINE = re.compile(
    r"^(.+)\s-\s\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\]\s*$", re.IGNORECASE
)
_ROSTER_HEADER = re.compile(
    r"^#\s*\+\+\s*Army Roster\s*\+\+\s*\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\]\s*$",
    re.IGNORECASE,
)
_ROSTER_HEADER_ANYWHERE = re.compile(r"^#\s*\+\+\s*Army Roster\s*\+\+", re.MULTILINE)
# Some exports omit the `# ++ Army Roster ++` line and open straight with a
# `## Section` heading — accept either marker.
_SECTION_HEADER_ANYWHERE = re.compile(r"^##\s+", re.MULTILINE)
_SECTION_HEADER = re.compile(r"^##\s*(.+?)(?:\s*\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\])?\s*$")
_UNIT_LINE = re.compile(
    r"^(.+?)\s*\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\](?:\s*:\s*(.*))?$", re.IGNORECASE
)
_BULLET = re.compile(
    r"^\s*•\s*(\d+)x\s+(.+?)(?:\s*\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\])?(?:\s*:\s*(.*))?\s*$"
)
_SPLIT_LINES = re.compile(r"\r?\n")


def _new_unit(name: str, displayed_pts: int | None) -> dict[str, Any]:
    return {
        "raw_name": name,
        "is_character": False,
        "is_warlord": False,
        "enhancement_raw_name": None,
        "enhancement_pts": 0,
        "displayed_pts": displayed_pts,
        "model_count": 1,
        # Aggregated wargear, keyed by name (insertion-ordered). Counts sum
        # across `• Nx ModelType` breakdowns.
        "wargear": {},
    }


def _apply_tokens(unit: dict[str, Any], tokens_csv: str, multiplier: int = 1) -> None:
    cls = classify_wargear_list(split_wargear_list(tokens_csv))
    if cls["is_warlord"]:
        unit["is_warlord"] = True
    if cls["is_character"]:
        unit["is_character"] = True
    if cls["enhancement_raw_name"] and unit["enhancement_raw_name"] is None:
        unit["enhancement_raw_name"] = cls["enhancement_raw_name"]
        unit["enhancement_pts"] = cls["enhancement_points"] or 0
    for w in cls["wargear"]:
        name = w["raw_name"]
        unit["wargear"][name] = unit["wargear"].get(name, 0) + w["count"] * multiplier


def _finish_unit(unit: dict[str, Any]) -> dict[str, Any]:
    displayed = unit["displayed_pts"]
    points = None if displayed is None else displayed - unit["enhancement_pts"]
    return {
        "raw_name": unit["raw_name"],
        "is_character": unit["is_character"],
        "model_count": unit["model_count"],
        "points": points,
        "is_warlord": unit["is_warlord"],
        "enhancement_raw_name": unit["enhancement_raw_name"],
        "enhancement_points": (
            None if unit["enhancement_raw_name"] is None else unit["enhancement_pts"]
        ),
        "wargear": [{"raw_name": n, "count": c} for n, c in unit["wargear"].items()],
    }


def _parse_first_line(line: str) -> dict[str, Any] | None:
    m = _FIRST_LINE.match(line)
    if not m:
        return None
    declared_limit = int(m.group(2))
    parts = [s for s in (p.strip() for p in m.group(1).split(" - ")) if s]
    if not parts:
        return None
    return {
        "name": parts[-1],
        "faction": parts[-2] if len(parts) >= 2 else None,
        "declared_limit": declared_limit,
    }


def _matches(decoded: Any) -> bool:
    if not isinstance(decoded, str):
        return False
    first_non_blank = next(
        (line for line in _SPLIT_LINES.split(decoded) if line.strip()), None
    )
    if not first_non_blank:
        return False
    if not _FIRST_LINE.match(first_non_blank):
        return False
    # Some exports omit the `# ++ Army Roster ++` line and open straight with
    # a `## Section` heading — accept either marker.
    return (
        _ROSTER_HEADER_ANYWHERE.search(decoded) is not None
        or _SECTION_HEADER_ANYWHERE.search(decoded) is not None
    )


def _parse(decoded: Any) -> dict[str, Any]:
    if not isinstance(decoded, str):
        raise ValueError("newrecruit-simple: input is not a string")
    lines = _SPLIT_LINES.split(decoded)

    name = "Imported roster"
    faction_raw_name: str | None = None
    declared_limit: int | None = None
    total_reported: int | None = None
    detachment_raw_name: str | None = None
    battle_size_raw: str | None = None
    units: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    multi_force = False
    section = "preamble"
    enhancement_pts: list[int] = []

    def finalize() -> None:
        nonlocal current
        if current is not None:
            enhancement_pts.append(current["enhancement_pts"])
            units.append(_finish_unit(current))
            current = None

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        # First non-blank line carries `<breadcrumb> - <faction> - <list> - [N pts]`.
        if section == "preamble" and name == "Imported roster":
            first = _parse_first_line(line)
            if first:
                name = first["name"]
                faction_raw_name = first["faction"]
                declared_limit = first["declared_limit"]
                continue

        roster_match = _ROSTER_HEADER.match(line)
        if roster_match:
            total_reported = int(roster_match.group(1))
            continue

        section_match = _SECTION_HEADER.match(line)
        if section_match:
            finalize()
            heading = section_match.group(1).strip().lower()
            if heading == "configuration":
                section = "configuration"
            else:
                section = "units"
                if "allied" in heading:
                    multi_force = True
            continue

        if section == "configuration":
            # Some exports list units directly after Configuration with no units
            # section heading; a `Name [N pts]` line ends the configuration block.
            if _UNIT_LINE.match(line):
                section = "units"
            else:
                idx = line.find(":")
                if idx > 0:
                    key = line[:idx].strip().lower()
                    value = line[idx + 1 :].strip()
                    if key == "battle size":
                        battle_size_raw = value
                    elif key == "detachment":
                        detachment_raw_name = value
                continue

        # Unit section. A bullet line extends the *current* unit.
        bullet_match = _BULLET.match(raw)
        if bullet_match and current is not None:
            count = int(bullet_match.group(1))
            # Bullets may add to the unit's model count beyond the implicit 1
            # we set when we created it from the unit header.
            if not current["wargear"] and current["model_count"] == 1:
                # First bullet: replace the implicit single-model assumption.
                current["model_count"] = count
            else:
                current["model_count"] += count
            if bullet_match.group(4):
                _apply_tokens(current, bullet_match.group(4), count)
            continue

        unit_match = _UNIT_LINE.match(line)
        if unit_match:
            finalize()
            unit_name = unit_match.group(1).strip()
            pts = int(unit_match.group(2))
            current = _new_unit(unit_name, pts)
            inline_wargear = (unit_match.group(3) or "").strip()
            if inline_wargear:
                _apply_tokens(current, inline_wargear, 1)
            # Leave model_count at the default 1. If `•` bullet lines follow,
            # the bullet handler resets model_count to the summed counts.
            continue

    finalize()

    total_computed = 0
    for i, u in enumerate(units):
        total_computed += u["points"] or 0
        total_computed += enhancement_pts[i] if i < len(enhancement_pts) else 0

    return {
        "name": name,
        "generated_by": None,
        "faction_raw_name": faction_raw_name,
        "detachment_raw_name": detachment_raw_name,
        "battle_size_raw": battle_size_raw,
        "declared_limit": declared_limit,
        "total_reported": total_reported,
        "total_computed": total_computed,
        "units": units,
        "multi_force": multi_force,
    }


newrecruit_simple_adapter = FormatAdapter(id="newrecruit-simple", matches=_matches, parse=_parse)
