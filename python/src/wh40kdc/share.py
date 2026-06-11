"""Compact, URL-safe list sharing — the Python mirror of the TS ``share`` module.

:func:`encode_share_token` packs a share list (the lossless essential subset of
a roster) into a ``share-v1`` token: registry-indexed unsigned-LEB128 varints,
base64url, no gzip. :func:`decode_share_token` reverses it against the embedded
registry. The wire format and registry are documented in
``tools/docs/share-token.md``; the ``conformance/share`` corpus pins this
implementation byte-for-byte against the TS and Rust ports.

Lists are plain dicts with the same camelCase keys the corpus uses, e.g.::

    {
        "name": "My List",
        "factionId": "adeptus-astartes",
        "detachmentIds": ["gladius-task-force"],
        "battleSize": "strike-force",
        "disposition": None,
        "units": [
            {
                "datasheetId": "intercessor-squad",
                "modelCount": 5,
                "isWarlord": True,
                "enhancementId": None,
                "allyFactionId": None,
                "allyRuleId": None,
                "attachedToOrdinal": None,
                "grants": [],
                "loadout": [["bolt-rifle", 5]],
            }
        ],
    }
"""

from __future__ import annotations

import base64
import json
from functools import lru_cache
from importlib import resources
from typing import Any

#: Current wire-format version. Bumped only if the byte layout changes.
SHARE_FORMAT_VERSION = 1

_FLAG_WARLORD = 1 << 0
_FLAG_ENH = 1 << 1
_FLAG_ATTACH = 1 << 2
_FLAG_ALLY = 1 << 3
_FLAG_GRANTS = 1 << 4

_BATTLE_SIZES = ("incursion", "strike-force")

SHARE_KINDS = (
    "faction",
    "detachment",
    "unit",
    "wargear",
    "enhancement",
    "ally_rule",
    "disposition",
)

ShareList = dict[str, Any]
DecodeResult = dict[str, Any]


class ShareEncodeError(ValueError):
    """An id absent from the registry — the only way encoding can fail."""


class _Malformed(Exception):
    """Internal: truncated or self-inconsistent byte stream."""


class _StaleRegistry(Exception):
    """Internal: a slot the embedded registry doesn't have."""


class _RegistryIndex:
    """Bidirectional id<->index lookup over one registry, with aliases folded in."""

    def __init__(self, registry: dict[str, Any]) -> None:
        self.version: int = registry["version"]
        kinds = registry.get("kinds", {})
        aliases: dict[str, str] = registry.get("aliases", {})
        self._to_index: dict[str, dict[str, int]] = {}
        self._from_index: dict[str, list[str]] = {}
        for kind in SHARE_KINDS:
            ids = kinds.get(kind, [])
            to_idx: dict[str, int] = {}
            frm: list[str] = []
            for i, id_ in enumerate(ids):
                to_idx[id_] = i
                # Decode resolves a slot to its current id (rewriting a rename).
                frm.append(aliases.get(id_, id_))
            # Encode must also find the current id at a renamed slot.
            for old_id, new_id in aliases.items():
                slot = to_idx.get(old_id)
                if slot is not None and new_id not in to_idx:
                    to_idx[new_id] = slot
            self._to_index[kind] = to_idx
            self._from_index[kind] = frm

    def index(self, kind: str, id_: str) -> int | None:
        return self._to_index[kind].get(id_)

    def id(self, kind: str, index: int) -> str | None:
        ids = self._from_index[kind]
        return ids[index] if 0 <= index < len(ids) else None


@lru_cache(maxsize=1)
def _embedded_index() -> _RegistryIndex:
    text = resources.files("wh40kdc").joinpath("_share_registry.json").read_text(encoding="utf-8")
    return _RegistryIndex(json.loads(text))


def share_registry_version() -> int:
    """Registry version this package embeds (stamped into every token it writes)."""
    return _embedded_index().version


# -- varint + base64url --------------------------------------------------------


def _write_varint(out: bytearray, value: int) -> None:
    if value < 0:
        raise ShareEncodeError(f"varint expects a non-negative integer, got {value}")
    v = value
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v)


def _write_str(out: bytearray, s: str) -> None:
    encoded = s.encode("utf-8")
    _write_varint(out, len(encoded))
    out.extend(encoded)


class _Reader:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0

    def byte(self) -> int:
        if self._pos >= len(self._data):
            raise _Malformed()
        b = self._data[self._pos]
        self._pos += 1
        return b

    def varint(self) -> int:
        result = 0
        shift = 0
        while True:
            b = self.byte()
            if shift >= 64:
                raise _Malformed()
            result |= (b & 0x7F) << shift
            if not (b & 0x80):
                return result
            shift += 7

    def string(self) -> str:
        length = self.varint()
        end = self._pos + length
        if end > len(self._data):
            raise _Malformed()
        chunk = self._data[self._pos : end]
        self._pos = end
        try:
            return chunk.decode("utf-8")
        except UnicodeDecodeError as e:  # pragma: no cover - defensive
            raise _Malformed() from e


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(token: str) -> bytes:
    pad = "=" * (-len(token) % 4)
    return base64.urlsafe_b64decode(token + pad)


# -- encode --------------------------------------------------------------------


def _require_index(idx: _RegistryIndex, kind: str, id_: str) -> int:
    i = idx.index(kind, id_)
    if i is None:
        raise ShareEncodeError(
            f'share registry has no {kind} id "{id_}" — run `npm run registry:build` '
            "and re-sync the bundles"
        )
    return i


def encode_share_list(list_: ShareList, registry: _RegistryIndex) -> str:
    """Encode a share list into a URL-safe ``share-v1`` token using ``registry``."""
    out = bytearray()
    out.append(SHARE_FORMAT_VERSION)
    _write_varint(out, registry.version)
    _write_str(out, list_.get("name", "") or "")

    faction_id = list_.get("factionId")
    _write_varint(out, 0 if faction_id is None else _require_index(registry, "faction", faction_id) + 1)
    battle = list_.get("battleSize", "strike-force")
    _write_varint(out, _BATTLE_SIZES.index(battle) if battle in _BATTLE_SIZES else 0)
    disposition = list_.get("disposition")
    _write_varint(
        out, 0 if disposition is None else _require_index(registry, "disposition", disposition) + 1
    )

    detachments = list_.get("detachmentIds", [])
    _write_varint(out, len(detachments))
    for det in detachments:
        _write_varint(out, _require_index(registry, "detachment", det))

    units = list_.get("units", [])
    _write_varint(out, len(units))
    for u in units:
        _write_varint(out, _require_index(registry, "unit", u["datasheetId"]))
        _write_varint(out, u["modelCount"])
        enhancement_id = u.get("enhancementId")
        attached = u.get("attachedToOrdinal")
        ally_faction = u.get("allyFactionId")
        ally_rule = u.get("allyRuleId")
        grants = u.get("grants") or []
        loadout = u.get("loadout") or []
        flags = (
            (_FLAG_WARLORD if u.get("isWarlord") else 0)
            | (_FLAG_ENH if enhancement_id else 0)
            | (_FLAG_ATTACH if attached is not None else 0)
            | (_FLAG_ALLY if (ally_rule or ally_faction) else 0)
            | (_FLAG_GRANTS if grants else 0)
        )
        _write_varint(out, flags)
        if enhancement_id:
            _write_varint(out, _require_index(registry, "enhancement", enhancement_id))
        if attached is not None:
            _write_varint(out, attached)
        if flags & _FLAG_ALLY:
            _write_varint(
                out, 0 if ally_faction is None else _require_index(registry, "faction", ally_faction) + 1
            )
            _write_varint(
                out, 0 if ally_rule is None else _require_index(registry, "ally_rule", ally_rule) + 1
            )
        if grants:
            _write_varint(out, len(grants))
            for g in grants:
                _write_str(out, g)
        _write_varint(out, len(loadout))
        for wid, count in loadout:
            _write_varint(out, _require_index(registry, "wargear", wid))
            _write_varint(out, count)

    return _b64url_encode(bytes(out))


def encode_share_token(list_: ShareList) -> str:
    """Encode a share list using the package's embedded registry."""
    return encode_share_list(list_, _embedded_index())


# -- decode --------------------------------------------------------------------


def _require_id(idx: _RegistryIndex, kind: str, slot: int) -> str:
    id_ = idx.id(kind, slot)
    if id_ is None:
        raise _StaleRegistry()
    return id_


def _decode_inner(token: str, registry: _RegistryIndex) -> ShareList:
    try:
        data = _b64url_decode(token)
    except Exception as e:  # invalid base64 → malformed
        raise _Malformed() from e
    r = _Reader(data)
    if r.byte() != SHARE_FORMAT_VERSION:
        raise _Malformed()
    r.varint()  # registry version — informational; bounds checks gate staleness

    name = r.string()
    faction_ref = r.varint()
    faction_id = None if faction_ref == 0 else _require_id(registry, "faction", faction_ref - 1)
    battle_idx = r.varint()
    battle_size = _BATTLE_SIZES[battle_idx] if battle_idx < len(_BATTLE_SIZES) else "strike-force"
    disposition_ref = r.varint()
    disposition = (
        None if disposition_ref == 0 else _require_id(registry, "disposition", disposition_ref - 1)
    )

    det_count = r.varint()
    detachment_ids = [_require_id(registry, "detachment", r.varint()) for _ in range(det_count)]

    unit_count = r.varint()
    units: list[dict[str, Any]] = []
    for _ in range(unit_count):
        datasheet_id = _require_id(registry, "unit", r.varint())
        model_count = r.varint()
        flags = r.varint()
        enhancement_id = (
            _require_id(registry, "enhancement", r.varint()) if flags & _FLAG_ENH else None
        )
        attached = r.varint() if flags & _FLAG_ATTACH else None
        ally_faction_id = None
        ally_rule_id = None
        if flags & _FLAG_ALLY:
            f_ref = r.varint()
            ally_faction_id = None if f_ref == 0 else _require_id(registry, "faction", f_ref - 1)
            rule_ref = r.varint()
            ally_rule_id = None if rule_ref == 0 else _require_id(registry, "ally_rule", rule_ref - 1)
        grants: list[str] = []
        if flags & _FLAG_GRANTS:
            for _ in range(r.varint()):
                grants.append(r.string())
        loadout: list[list[Any]] = []
        for _ in range(r.varint()):
            wid = _require_id(registry, "wargear", r.varint())
            loadout.append([wid, r.varint()])
        units.append(
            {
                "datasheetId": datasheet_id,
                "modelCount": model_count,
                "isWarlord": bool(flags & _FLAG_WARLORD),
                "enhancementId": enhancement_id,
                "allyFactionId": ally_faction_id,
                "allyRuleId": ally_rule_id,
                "attachedToOrdinal": attached,
                "grants": grants,
                "loadout": loadout,
            }
        )

    return {
        "name": name,
        "factionId": faction_id,
        "detachmentIds": detachment_ids,
        "battleSize": battle_size,
        "disposition": disposition,
        "units": units,
    }


def decode_share_list(token: str, registry: _RegistryIndex) -> DecodeResult:
    """Decode a ``share-v1`` token against ``registry``."""
    try:
        return {"ok": True, "list": _decode_inner(token, registry)}
    except _StaleRegistry:
        return {"ok": False, "reason": "stale-registry"}
    except Exception:
        return {"ok": False, "reason": "malformed"}


def decode_share_token(token: str) -> DecodeResult:
    """Decode a ``share-v1`` token using the package's embedded registry."""
    return decode_share_list(token, _embedded_index())
