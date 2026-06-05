"""Decode a ListForge share payload into a JSON object.

ListForge packs a roster as ``base64( gzip( utf8(json) ) )`` and embeds it in
a URL hash fragment: ``https://app/#/listforge/<BASE64>``. A valid gzipped
payload always base64-encodes to a string starting with ``H4sIA``.

:func:`decode_listforge` accepts any of three forms and returns the parsed
JSON: a full URL (the segment after the marker / last ``/`` is taken), a bare
base64 segment, or an already-decoded JSON string.

Python mirror of ``tools/src/import/decode.ts`` (stdlib ``base64``/``gzip``
only).
"""

from __future__ import annotations

import base64
import gzip
import json
import re
from typing import Any

#: The base64 prefix every ListForge gzip payload begins with.
GZIP_BASE64_PREFIX = "H4sIA"

#: The path marker ListForge uses ahead of the payload.
LISTFORGE_MARKER = "/listforge/"

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


def _extract_segment(input: str) -> str:
    """Extract the payload segment from an input that may be a URL.

    The base64 alphabet includes ``/``, so a bare base64 segment cannot be
    split on ``/``. The input is treated as a URL only when it carries the
    ``/listforge/`` marker or an ``http(s)://`` scheme.
    """
    marker_index = input.find(LISTFORGE_MARKER)
    if marker_index != -1:
        return input[marker_index + len(LISTFORGE_MARKER) :]
    if _URL_RE.match(input):
        last_slash = input.rfind("/")
        return input if last_slash == -1 else input[last_slash + 1 :]
    return input


def decode_listforge(input: str) -> Any:
    """Decode a ListForge payload (URL, bare base64, or raw JSON) into a JSON value.

    Raises ``ValueError`` if the input is neither valid JSON nor a decodable
    gzip payload.
    """
    trimmed = input.strip()
    if trimmed == "":
        raise ValueError("decode_listforge: empty input")

    # Raw JSON object passed directly.
    if trimmed.startswith("{"):
        return json.loads(trimmed)

    segment = _extract_segment(trimmed)

    if not segment.startswith(GZIP_BASE64_PREFIX):
        raise ValueError(
            "decode_listforge: input is not a ListForge payload (expected raw "
            "JSON, or a gzip+base64 segment beginning with "
            f'"{GZIP_BASE64_PREFIX}…")'
        )

    try:
        payload = gzip.decompress(base64.b64decode(segment))
    except Exception as cause:
        raise ValueError("decode_listforge: failed to gunzip base64 payload") from cause

    return json.loads(payload.decode("utf-8"))
