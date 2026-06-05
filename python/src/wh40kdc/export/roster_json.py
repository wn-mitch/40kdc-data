"""Canonical Roster JSON serializer.

Emits the Roster as 2-space JSON, the same shape the importers consume. This
is the lossless pivot, so the pretty-printed text is exactly
``roster.schema.json`` shape.
"""

from __future__ import annotations

from wh40kdc.export.helpers import Roster, pretty_json


def serialize_roster_json(roster: Roster) -> str:
    return pretty_json(roster)
