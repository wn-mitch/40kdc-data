"""Canonical string encoding of base sizes for cross-impl comparison."""

from __future__ import annotations

from typing import Any


def encode_base(b: dict[str, Any] | None) -> str | None:
    """Canonical string encoding of a base size (mirrors ``maximal_loadout``'s
    string-encoding). Returns ``None`` for an absent base.

    - round 32     → ``"round:32"``
    - oval 75×42   → ``"oval:75x42"``
    - small flyer  → ``"flying-base:small:draft"``
    - hull (draft) → ``"hull:draft"``
    """
    if not b:
        return None
    parts: list[str] = [b["shape"]]
    if b["shape"] == "round" and b.get("diameter") is not None:
        parts.append(_num(b["diameter"]))
    elif b["shape"] == "oval" and b.get("width") is not None and b.get("length") is not None:
        parts.append(f"{_num(b['width'])}x{_num(b['length'])}")
    elif b["shape"] == "flying-base" and b.get("size"):
        parts.append(b["size"])
    if b.get("draft"):
        parts.append("draft")
    return ":".join(parts)


def _num(v: Any) -> str:
    """Format a number the way JS ``String()`` does: integral floats lose the
    ``.0`` (``32.0`` → ``"32"``)."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)
