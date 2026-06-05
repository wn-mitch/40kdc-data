"""Name normalization for diacritic- and punctuation-insensitive lookup.

Warhammer 40,000 is played globally and many entity names carry diacritics or
punctuation — "Khârn the Betrayer", "T'au", "Be'lakor". A user typing the
plain-ASCII form of a name must still find the entity. Every name comparison
in this package routes through :func:`normalize_name` so the matching rule is
defined in exactly one place; it is exported so consumers can reproduce the
same behaviour in their own search UIs.

This is the Python mirror of the TypeScript ``normalizeName``
(``tools/src/data/normalize.ts``); the implementations are pinned together by
the shared ``conformance/normalize.json`` corpus.
"""

from __future__ import annotations

import re
import unicodedata

# Mark category (Mn/Mc/Me) — every combining mark. The TS reference strips
# \p{M}; the smaller \p{Diacritic} property misses some Mn characters, which
# let TS and Rust drift apart on non-Latin combining marks (the Rust mirror
# uses unicode-normalization's is_combining_mark, which is \p{M}). Python's
# `re` has no \p{...} escapes, so the category check goes through unicodedata.
_MARK_CATEGORIES = ("Mn", "Mc", "Me")

_QUOTES_RE = re.compile(r"['’‘`\"“”]")
# Note: Python `\s` (Unicode whitespace), JS `\s`, and Rust char::is_whitespace
# (White_Space property) disagree on a few exotic chars (U+FEFF, U+0085,
# U+001C–001F) that no corpus case or fuzz-pool char exercises; like the Rust
# mirror, this uses the host language's Unicode whitespace class.
_SPACE_HYPHEN_RE = re.compile(r"[\s-]+")


def normalize_name(input: str) -> str:
    """Reduce a display name to a canonical lookup key.

    The transform, in order:

    1. Unicode NFD-decompose, then strip combining marks — ``Khârn`` → ``Kharn``.
    2. Casefold to lower case.
    3. Remove apostrophe and quote variants (``' ’ ‘ ` " “ ”``) — ``T'au`` → ``Tau``.
    4. Collapse any run of whitespace or hyphens to a single space, then trim —
       ``Be'lakor`` → ``belakor``, ``the   betrayer`` → ``the betrayer``.

    The result is intended only for comparison; it is not a display value.

    >>> normalize_name("Khârn the Betrayer")
    'kharn the betrayer'
    >>> normalize_name("T'au")
    'tau'
    """
    decomposed = unicodedata.normalize("NFD", input)
    # Strip marks *before* lowercasing — load-bearing for İ (U+0130), whose
    # lowercase form introduces a combining dot that must survive.
    stripped = "".join(c for c in decomposed if unicodedata.category(c) not in _MARK_CATEGORIES)
    lowered = stripped.lower()
    no_quotes = _QUOTES_RE.sub("", lowered)
    return _SPACE_HYPHEN_RE.sub(" ", no_quotes).strip()
