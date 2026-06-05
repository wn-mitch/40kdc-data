"""ListForge plain-text adapter: lower ListForge's copy-paste text export to a
``ParsedRoster``.

This is the bullet-list text users copy out of the ListForge app (distinct
from the base64+gzip share-JSON the ``listforge`` adapter handles). Shape::

    all gas no breaks - Chaos Daemons - Daemonic Incursion (1995 Points)

    Epic Hero:
    Rotigus (250 pts)
      • Gnarlrod
      • Streams of brackish filth

    Battleline:
    Bloodletters (110 pts)
      • Bloodreaper
        • Hellblade
      • Daemonic Icon
      • 9x Bloodletter
        • 9x Hellblade

- The first non-blank line is ``<list name> - <faction> - <detachment>
  (<N> Points)``. A list name containing `` - `` breaks the split — a
  documented ListForge limitation, not ours.
- Sections are mixed-case battlefield-role lines ending with ``:``
  (``Epic Hero:``, ``Character:``, ``Battleline:``, …). Units under
  ``Epic Hero:`` or ``Character:`` are characters.
- Bullet classification mirrors the GW adapter: a top-level bullet with deeper
  children is a **model group** (its ``Nx`` count — implicitly 1 — adds to the
  model count); without children it's **wargear**. Child-bullet ``Nx`` counts
  are already squad-wide totals; a child without a count is one item
  (``• Hellblade`` under a lone Bloodreaper).
- ``E: <name>`` is the enhancement annotation (ListForge reports no points for
  it, so ``enhancement_points`` stays None and unit points stay as displayed).
  A bare ``Warlord`` bullet flags the warlord.

**Disjointness**: the ``(N Points)`` first-line suffix is unique to this
format — newrecruit-simple's first line ends ``- [N pts]``, the GW export opens
with a ``++++`` fence, and the WTC formats carry ``N with`` lines or no bullets
at all.

Python mirror of ``tools/src/import/listforge-text.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.imports.adapter import FormatAdapter
from wh40kdc.imports.newrecruit_text import infer_battle_size_raw

_FIRST_LINE = re.compile(r"^(.+)\s\(\s*(\d+)\s*Points?\s*\)\s*$", re.IGNORECASE)
_SECTION_HEADER = re.compile(r"^[A-Za-z][A-Za-z0-9 /&'-]*:$")
_UNIT_HEADER = re.compile(r"^(.+?)\s*\(\s*(\d+)\s*pts?\s*\)\s*$", re.IGNORECASE)
_BULLET_LINE = re.compile(r"^(\s*)•\s*(.+?)\s*$")
_NX_PREFIX = re.compile(r"^(\d+)x\s+(.+)$")
_BULLET = re.compile(r"^[\t ]*•", re.MULTILINE)
_WITH_LINE = re.compile(r"^[\t ]*\d+\s+with\b", re.MULTILINE)
_SPLIT_LINES = re.compile(r"\r?\n")

_ENHANCEMENT_PREFIX = "E: "
_WARLORD_MARKER = "Warlord"
_CHARACTER_SECTIONS = frozenset({"epic hero", "character"})


def _is_listforge_text(decoded: Any) -> str | None:
    """Accept plain text whose first non-blank line is the ListForge
    ``name - faction - detachment (N Points)`` header, with ``•`` bullets and
    no WTC ``N with`` lines."""
    if not isinstance(decoded, str):
        return None
    first_non_blank = next(
        (line for line in _SPLIT_LINES.split(decoded) if line.strip()), None
    )
    if not first_non_blank:
        return None
    first = _FIRST_LINE.match(first_non_blank.strip())
    if not first or len(first.group(1).split(" - ")) < 3:
        return None
    if _BULLET.search(decoded) is None:
        return None
    if _WITH_LINE.search(decoded) is not None:
        return None
    return decoded


def _parse_first_line(line: str) -> dict[str, Any] | None:
    m = _FIRST_LINE.match(line.strip())
    if not m:
        return None
    parts = [s for s in (p.strip() for p in m.group(1).split(" - ")) if s]
    if len(parts) < 3:
        return None
    # `<list name> - <faction> - <detachment>`; the name is everything before
    # the trailing two segments so faction names with hyphens stay intact only
    # when ListForge itself doesn't insert ` - ` (it doesn't).
    return {
        "name": " - ".join(parts[: len(parts) - 2]),
        "faction_raw_name": parts[-2],
        "detachment_raw_name": parts[-1],
        "total_reported": int(m.group(2)),
    }


def _finish_unit(acc: dict[str, Any]) -> dict[str, Any]:
    bullets: list[dict[str, Any]] = acc["bullets"]
    top_indent = min((b["indent"] for b in bullets), default=0)

    # Insertion-ordered aggregation (dict preserves order, matching the TS Map).
    wargear: dict[str, int] = {}
    model_count = 0
    is_warlord = False
    enhancement_raw_name: str | None = None

    def add_wargear(raw_name: str, count: int) -> None:
        wargear[raw_name] = wargear.get(raw_name, 0) + count

    for i, b in enumerate(bullets):
        # Child bullet: a model group's weapon. ListForge child counts are
        # squad-wide totals; a count-less child is a single item.
        if b["indent"] > top_indent:
            add_wargear(b["text"], b["count"] if b["count"] is not None else 1)
            continue

        # Top-level annotations.
        if b["count"] is None:
            if b["text"] == _WARLORD_MARKER:
                is_warlord = True
                continue
            if b["text"].startswith(_ENHANCEMENT_PREFIX):
                if enhancement_raw_name is None:
                    enhancement_raw_name = b["text"][len(_ENHANCEMENT_PREFIX) :].strip()
                continue

        # Top-level entry: a model group when it has child bullets beneath it,
        # otherwise plain wargear. Either way a missing `Nx` count means 1.
        next_bullet = bullets[i + 1] if i + 1 < len(bullets) else None
        if next_bullet is not None and next_bullet["indent"] > b["indent"]:
            model_count += b["count"] if b["count"] is not None else 1
        else:
            add_wargear(b["text"], b["count"] if b["count"] is not None else 1)

    if model_count == 0:
        model_count = 1

    return {
        "raw_name": acc["raw_name"],
        "is_character": acc["is_character"],
        "model_count": model_count,
        "points": acc["displayed_pts"],
        "is_warlord": is_warlord,
        "enhancement_raw_name": enhancement_raw_name,
        # ListForge's text export reports no enhancement cost, so the unit's
        # displayed points stay as-is and no enhancement points are claimed.
        "enhancement_points": None,
        "wargear": [{"raw_name": n, "count": c} for n, c in wargear.items()],
    }


def _matches(decoded: Any) -> bool:
    return _is_listforge_text(decoded) is not None


def _parse(decoded: Any) -> dict[str, Any]:
    text = _is_listforge_text(decoded)
    if text is None:
        raise ValueError("listforge-text: input is not a ListForge text export")

    lines = _SPLIT_LINES.split(text)
    header: dict[str, Any] | None = None
    units: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    section_is_character = False

    def finalize() -> None:
        nonlocal current
        if current is not None:
            units.append(_finish_unit(current))
            current = None

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        if header is None:
            header = _parse_first_line(line)
            if header is not None:
                continue

        bullet_match = _BULLET_LINE.match(raw)
        if bullet_match:
            if current is not None:
                rest = bullet_match.group(2)
                nx = _NX_PREFIX.match(rest)
                current["bullets"].append(
                    {
                        "indent": len(bullet_match.group(1)),
                        "count": int(nx.group(1)) if nx else None,
                        "text": (nx.group(2) if nx else rest).strip(),
                    }
                )
            continue

        if _SECTION_HEADER.match(line):
            finalize()
            section_is_character = line[:-1].strip().lower() in _CHARACTER_SECTIONS
            continue

        unit_match = _UNIT_HEADER.match(line)
        if unit_match:
            finalize()
            current = {
                "raw_name": unit_match.group(1).strip(),
                "displayed_pts": int(unit_match.group(2)),
                "is_character": section_is_character,
                "bullets": [],
            }

    finalize()

    if header is None:
        raise ValueError("listforge-text: missing ListForge header line")

    total_computed = 0
    for u in units:
        total_computed += u["points"] or 0

    # Like the GW export, ListForge text reports only the army total — use it as
    # the declared limit so battle-size inference stays round-trippable.
    declared_limit = header["total_reported"]

    return {
        "name": header["name"],
        "generated_by": "List Forge",
        "faction_raw_name": header["faction_raw_name"],
        "detachment_raw_name": header["detachment_raw_name"],
        "battle_size_raw": infer_battle_size_raw(declared_limit),
        "declared_limit": declared_limit,
        "total_reported": header["total_reported"],
        "total_computed": total_computed,
        "units": units,
        "multi_force": False,
    }


listforge_text_adapter = FormatAdapter(id="listforge-text", matches=_matches, parse=_parse)
