"""Roster exporters — the symmetric counterpart to the importer.

``export_roster(roster, format)`` dispatches to one of six registered
serializers (NewRecruit JSON, the three NewRecruit text formats, the
canonical Roster JSON, and Rosterizer). Each serializer is deterministic and
Dataset-free, so the TS, Rust, and Python mirrors produce byte-identical
output for cross-implementation conformance.
"""

from __future__ import annotations

from collections.abc import Callable

from wh40kdc.export.helpers import (
    Roster,
    char_slot_assignment,
    displayed_unit_points,
    pretty_json,
    title_case_id,
    total_army_points,
)
from wh40kdc.export.newrecruit_json import serialize_newrecruit_json
from wh40kdc.export.newrecruit_simple import serialize_newrecruit_simple
from wh40kdc.export.newrecruit_wtc import (
    serialize_newrecruit_wtc_compact,
    serialize_newrecruit_wtc_full,
)
from wh40kdc.export.roster_json import serialize_roster_json
from wh40kdc.export.rosterizer import serialize_rosterizer

#: All registered serializers, keyed by their export-format id.
SERIALIZERS: dict[str, Callable[[Roster], str]] = {
    "newrecruit-json": serialize_newrecruit_json,
    "newrecruit-wtc-compact": serialize_newrecruit_wtc_compact,
    "newrecruit-wtc-full": serialize_newrecruit_wtc_full,
    "newrecruit-simple": serialize_newrecruit_simple,
    "roster-json": serialize_roster_json,
    "rosterizer": serialize_rosterizer,
}

EXPORT_FORMATS = tuple(SERIALIZERS)


def export_roster(roster: Roster, format: str) -> str:
    """Serialize a Roster into the named target format."""
    serializer = SERIALIZERS.get(format)
    if serializer is None:
        registered = ", ".join(SERIALIZERS)
        raise ValueError(f"unknown export format: {format} (registered: {registered})")
    return serializer(roster)


__all__ = [
    "EXPORT_FORMATS",
    "SERIALIZERS",
    "char_slot_assignment",
    "displayed_unit_points",
    "export_roster",
    "pretty_json",
    "serialize_newrecruit_json",
    "serialize_newrecruit_simple",
    "serialize_newrecruit_wtc_compact",
    "serialize_newrecruit_wtc_full",
    "serialize_roster_json",
    "serialize_rosterizer",
    "title_case_id",
    "total_army_points",
]
