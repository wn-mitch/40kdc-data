"""NewRecruit "wtc-compact" and "wtc-full" text adapters.

Both formats open with a ``++++++++`` summary header carrying FACTION
KEYWORD, DETACHMENT, TOTAL ARMY POINTS, WARLORD, ENHANCEMENT(s), NUMBER OF
UNITS, and SECONDARY tournament-objective shorthand. The body diverges:

- **wtc-compact** — one unit per line:
  ``[CharN: ]Nx <Unit> (P pts): <comma-separated wargear>`` followed
  optionally by ``Enhancement: <Name> (+P pts)`` on the next line.
- **wtc-full** — uppercase section headers (``BATTLELINE``, ``ALLIED
  UNITS``), two-line unit blocks (``[CharN: ]Nx <Unit> (P pts)`` then
  ``N with <wargear>``), ``Enhancement:`` lines, and per-model-type
  breakdowns with ``• Nx <ModelType>`` lines.

The Roster pivot stores units at unit granularity — per-model-type wargear
breakdowns and ``CharN:`` slot numbers aren't modelled, so this adapter
collapses them. Enhancement points are subtracted from the displayed unit
total so the parsed unit's ``points`` is the *base* unit cost, matching the
ListForge convention.

Python mirror of ``tools/src/import/newrecruit-wtc.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.imports.adapter import FormatAdapter
from wh40kdc.imports.newrecruit_text import (
    classify_wargear_list,
    faction_from_keyword,
    infer_battle_size_raw,
    split_wargear_list,
    strip_parenthetical,
)

WTC_HEADER_PREFIX = "+ FACTION KEYWORD:"

# --- header parsing ----------------------------------------------------------

_HEADER_FACTION = re.compile(r"^\+\s*FACTION KEYWORD:\s*(.+?)\s*$", re.IGNORECASE)
_HEADER_DETACHMENT = re.compile(r"^\+\s*DETACHMENT:\s*(.+?)\s*$", re.IGNORECASE)
_HEADER_TOTAL_POINTS = re.compile(r"^\+\s*TOTAL ARMY POINTS:\s*(\d+)\s*pts?\s*$", re.IGNORECASE)
_HEADER_POINTS_LIMIT = re.compile(r"^\+\s*POINTS LIMIT:\s*(\d+)\s*pts?\s*$", re.IGNORECASE)
_HEADER_LIST_NAME = re.compile(r"^\+\s*LIST NAME:\s*(.+?)\s*$", re.IGNORECASE)

_FENCE = re.compile(r"^\++\s*$")
_SPLIT_LINES = re.compile(r"\r?\n")


def _parse_wtc_header(text: str) -> tuple[dict[str, Any], int] | None:
    """Parse the leading ``++++ ... ++++`` block. None if no header found."""
    lines = _SPLIT_LINES.split(text)
    faction_raw_name: str | None = None
    detachment_raw_name: str | None = None
    total_reported: int | None = None
    points_limit: int | None = None
    list_name: str | None = None

    # Two `+++++…` fence lines wrap the header. Find them.
    fence_indices: list[int] = []
    for i, line in enumerate(lines):
        if len(fence_indices) >= 2:
            break
        if _FENCE.match(line):
            fence_indices.append(i)

    saw_faction_keyword = False
    for line in lines:
        if not line.startswith("+"):
            continue
        m = _HEADER_FACTION.match(line)
        if m:
            faction_raw_name = faction_from_keyword(m.group(1))
            saw_faction_keyword = True
            continue
        m = _HEADER_DETACHMENT.match(line)
        if m:
            detachment_raw_name = strip_parenthetical(m.group(1))
            continue
        m = _HEADER_TOTAL_POINTS.match(line)
        if m:
            total_reported = int(m.group(1))
            continue
        m = _HEADER_POINTS_LIMIT.match(line)
        if m:
            points_limit = int(m.group(1))
            continue
        m = _HEADER_LIST_NAME.match(line)
        if m:
            list_name = m.group(1)

    if not saw_faction_keyword:
        return None

    body_start = fence_indices[1] + 1 if len(fence_indices) >= 2 else 0
    # POINTS LIMIT is the army's points ceiling. When the source carries only
    # a single figure (the tournament default), fall back to it.
    declared_limit = points_limit if points_limit is not None else total_reported

    header = {
        "name": list_name if list_name is not None else "Imported roster",
        "faction_raw_name": faction_raw_name,
        "detachment_raw_name": detachment_raw_name,
        "declared_limit": declared_limit,
        "total_reported": total_reported,
        "battle_size_raw": infer_battle_size_raw(declared_limit),
    }
    return header, body_start


# --- shared body helpers -----------------------------------------------------

_UNIT_HEADER_COMPACT = re.compile(
    r"^(?:Char\d+:\s*)?(\d+)x\s+(.+?)\s*\(\s*(\d+)\s*pts?\s*\)\s*:\s*(.*)$", re.IGNORECASE
)
_UNIT_HEADER_FULL = re.compile(
    r"^(?:Char\d+:\s*)?(\d+)x\s+(.+?)\s*\(\s*(\d+)\s*pts?\s*\)\s*$", re.IGNORECASE
)
_ENHANCEMENT_LINE = re.compile(
    r"^Enhancement:\s*(.+?)\s*\(\+\s*(\d+)\s*pts?\s*\)\s*$", re.IGNORECASE
)
_WITH_PREFIX = re.compile(r"^(\d+)\s+with\s+(.*)$", re.IGNORECASE)
_MODEL_BREAKDOWN = re.compile(r"^\s*•\s*(\d+)x\s+(.+?)(?:\s*\[[^\]]*\])?\s*$")
_SECTION_HEADER = re.compile(r"^[A-Z][A-Z0-9 \-/&]+$")  # BATTLELINE, ALLIED UNITS, etc.
_HEADER_LINE = re.compile(r"^\+")
_CHAR_PREFIX = re.compile(r"^Char\d+:", re.IGNORECASE)


def _parse_with_group(text: str) -> tuple[int, str]:
    """``N with X, Y, Z`` means each of ``N`` models carries the same list —
    the weapon counts multiply by ``N``. Returns ``(1, text)`` when the line
    has no ``with`` prefix."""
    m = _WITH_PREFIX.match(text)
    if m:
        n = int(m.group(1))
        return (n if n > 0 else 1, m.group(2))
    return (1, text)


def _new_unit(
    name: str, displayed_pts: int, leading_count: int, is_character_prefix: bool
) -> dict[str, Any]:
    return {
        "raw_name": name,
        "is_character": is_character_prefix,
        "is_warlord": False,
        "enhancement_raw_name": None,
        # Total displayed pts from the header line; base computed once an
        # enhancement is known.
        "displayed_pts": displayed_pts,
        "enhancement_pts": 0,
        "model_count": leading_count if leading_count > 0 else 1,
        "wargear": {},  # name → count, insertion-ordered
    }


def _add_wargear(unit: dict[str, Any], items: list[dict[str, Any]]) -> None:
    for item in items:
        name = item["raw_name"]
        unit["wargear"][name] = unit["wargear"].get(name, 0) + item["count"]


def _apply_with_group(unit: dict[str, Any], list_text: str) -> None:
    multiplier, wargear_list = _parse_with_group(list_text)
    cls = classify_wargear_list(split_wargear_list(wargear_list))
    if cls["is_warlord"]:
        unit["is_warlord"] = True
    if cls["is_character"]:
        unit["is_character"] = True
    # wtc never inlines the enhancement points in the wargear list (that's
    # the simple format); wtc's enhancement is always parsed off the explicit
    # "Enhancement:" line.
    scaled = [
        {"raw_name": w["raw_name"], "count": w["count"] * multiplier} for w in cls["wargear"]
    ]
    _add_wargear(unit, scaled)


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


def _compute_total(units: list[dict[str, Any]], enhancement_pts: list[int]) -> int:
    """Compute total_computed by walking every parsed unit cost line."""
    total = 0
    for i, u in enumerate(units):
        total += u["points"] or 0
        total += enhancement_pts[i] if i < len(enhancement_pts) else 0
    return total


def _attach_enhancement(unit: dict[str, Any], raw_name: str, pts: int) -> None:
    unit["enhancement_raw_name"] = raw_name.strip()
    unit["enhancement_pts"] = pts


# --- compact body parser -----------------------------------------------------


def _parse_compact_body(body: str) -> tuple[list[dict[str, Any]], list[int]]:
    lines = _SPLIT_LINES.split(body)
    units: list[dict[str, Any]] = []
    enhancement_pts: list[int] = []
    current: dict[str, Any] | None = None

    def finalize() -> None:
        nonlocal current
        if current is not None:
            units.append(_finish_unit(current))
            enhancement_pts.append(current["enhancement_pts"])
            current = None

    for raw in lines:
        line = raw.strip()
        if not line or _HEADER_LINE.match(line) or _FENCE.match(line):
            continue

        enh = _ENHANCEMENT_LINE.match(line)
        if enh and current is not None:
            _attach_enhancement(current, enh.group(1), int(enh.group(2)))
            # Emit immediately so subsequent unit lines start fresh.
            finalize()
            continue

        unit_match = _UNIT_HEADER_COMPACT.match(line)
        if unit_match:
            finalize()
            leading_count = int(unit_match.group(1))
            name = unit_match.group(2).strip()
            pts = int(unit_match.group(3))
            is_character_prefix = _CHAR_PREFIX.match(line) is not None
            current = _new_unit(name, pts, leading_count, is_character_prefix)
            _apply_with_group(current, unit_match.group(4))
            continue

    finalize()
    return units, enhancement_pts


# --- full body parser --------------------------------------------------------


def _parse_full_body(body: str) -> tuple[list[dict[str, Any]], list[int]]:
    lines = _SPLIT_LINES.split(body)
    units: list[dict[str, Any]] = []
    enhancement_pts: list[int] = []
    current: dict[str, Any] | None = None
    breakdown_models = 0

    def finalize() -> None:
        nonlocal current, breakdown_models
        if current is not None:
            if breakdown_models > 0:
                current["model_count"] = breakdown_models
            units.append(_finish_unit(current))
            enhancement_pts.append(current["enhancement_pts"])
            current = None
            breakdown_models = 0

    for raw in lines:
        line = raw.strip()
        if not line or _HEADER_LINE.match(line) or _FENCE.match(line):
            continue
        if _SECTION_HEADER.match(line) and not _UNIT_HEADER_FULL.match(line):
            finalize()
            continue

        enh = _ENHANCEMENT_LINE.match(line)
        if enh and current is not None:
            _attach_enhancement(current, enh.group(1), int(enh.group(2)))
            continue

        unit_match = _UNIT_HEADER_FULL.match(line)
        if unit_match:
            finalize()
            leading_count = int(unit_match.group(1))
            name = unit_match.group(2).strip()
            pts = int(unit_match.group(3))
            is_character_prefix = _CHAR_PREFIX.match(line) is not None
            current = _new_unit(name, pts, leading_count, is_character_prefix)
            continue

        breakdown = _MODEL_BREAKDOWN.match(raw)
        if breakdown and current is not None:
            breakdown_models += int(breakdown.group(1))
            continue

        if _WITH_PREFIX.match(line) and current is not None:
            _apply_with_group(current, line)
            continue

    finalize()
    return units, enhancement_pts


# --- multi-force detection ---------------------------------------------------

_ALLIED_UNITS_RE = re.compile(r"^ALLIED UNITS\s*$", re.IGNORECASE | re.MULTILINE)


def _detect_multi_force(text: str, format: str) -> bool:
    """wtc-full has an explicit ``ALLIED UNITS`` section header; wtc-compact
    has no section markers, so assume single-force."""
    if format == "wtc-full":
        return _ALLIED_UNITS_RE.search(text) is not None
    return False


# --- adapters ----------------------------------------------------------------


def _is_wtc_text(decoded: Any) -> str | None:
    if not isinstance(decoded, str):
        return None
    # Both wtc formats begin with the FACTION KEYWORD header line (possibly
    # after some leading whitespace/fence characters).
    if WTC_HEADER_PREFIX not in decoded:
        return None
    return decoded


_FULL_FORMAT_RE = re.compile(r"^[\t ]*\d+\s+with\b", re.MULTILINE)
_BULLETS_RE = re.compile(r"^[\t ]*•", re.MULTILINE)


def _is_full_format(text: str) -> bool:
    """wtc-full has a line starting with ``N with `` at the start of a body
    line (compact only puts ``N with`` after ``:`` on the unit-header line)."""
    return _FULL_FORMAT_RE.search(text) is not None


def _has_bullets(text: str) -> bool:
    """``•``-prefixed body lines. wtc-full uses them for per-model breakdowns;
    the GW app format uses them for every wargear entry. wtc-compact never
    emits them, so its matcher excludes them to stay disjoint from GW."""
    return _BULLETS_RE.search(text) is not None


def _parse_with_format(text: str, format: str) -> dict[str, Any]:
    parsed = _parse_wtc_header(text)
    if parsed is None:
        raise ValueError(f'{format}: missing "+ FACTION KEYWORD:" header')
    header, body_start = parsed
    body = "\n".join(_SPLIT_LINES.split(text)[body_start:])
    units, enhancement_pts = (
        _parse_full_body(body) if format == "wtc-full" else _parse_compact_body(body)
    )

    return {
        "name": header["name"],
        "generated_by": None,
        "faction_raw_name": header["faction_raw_name"],
        "detachment_raw_names": (
            [header["detachment_raw_name"]] if header["detachment_raw_name"] else []
        ),
        "battle_size_raw": header["battle_size_raw"],
        "declared_limit": header["declared_limit"],
        "total_reported": header["total_reported"],
        "total_computed": _compute_total(units, enhancement_pts),
        "units": units,
        "multi_force": _detect_multi_force(text, format),
    }


def _matches_compact(decoded: Any) -> bool:
    text = _is_wtc_text(decoded)
    if text is None:
        return False
    # wtc-compact has no `N with` lines (that's wtc-full) and no `•` bullets
    # (that's the GW app format) — excluding both keeps the matcher disjoint.
    return not _is_full_format(text) and not _has_bullets(text)


def _parse_compact(decoded: Any) -> dict[str, Any]:
    text = _is_wtc_text(decoded)
    if text is None:
        raise ValueError("newrecruit-wtc-compact: input is not a string")
    return _parse_with_format(text, "wtc-compact")


def _matches_full(decoded: Any) -> bool:
    text = _is_wtc_text(decoded)
    if text is None:
        return False
    return _is_full_format(text)


def _parse_full(decoded: Any) -> dict[str, Any]:
    text = _is_wtc_text(decoded)
    if text is None:
        raise ValueError("newrecruit-wtc-full: input is not a string")
    return _parse_with_format(text, "wtc-full")


newrecruit_wtc_compact_adapter = FormatAdapter(
    id="newrecruit-wtc-compact", matches=_matches_compact, parse=_parse_compact
)
newrecruit_wtc_full_adapter = FormatAdapter(
    id="newrecruit-wtc-full", matches=_matches_full, parse=_parse_full
)
