"""Declared answers for leaf conditions the engine cannot evaluate from its context.

A leaf condition the context does not decide ("while an enemy unit is engaged with this unit",
"if this unit disembarked this turn") evaluates to ``"unknown"``. The translator reports each such
leaf as a need (``{key, condition, perspective}``); the caller answers it in the context's
``conditionFacts`` under the need's ``key``, and the leaf then evaluates to that answer. A compound
(``and``/``or``/``not``) is never a need itself: it evaluates from its leaves.

Python mirror of ``tools/src/cruncher/condition-facts.ts``. Keys are byte-identical across ports.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Callable
from typing import Any

ConditionNeed = dict[str, Any]

_SURROGATE = re.compile("[\ud800-\udfff]")


def canonical_json(value: Any) -> str:
    """JSON with object keys sorted at every depth and no whitespace, so equal conditions
    serialize to equal text in every port. Matches TS ``JSON.stringify``: keys sort by UTF-16
    code unit, non-ASCII stays unescaped, and numbers print as JS prints them."""
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda k: k.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(f"{_json_str(k)}:{canonical_json(value[k])}" for k in keys) + "}"
    if isinstance(value, str):
        return _json_str(value)
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, (int, float)):
        return _js_number(float(value))
    raise TypeError(f"canonical_json: unsupported value {value!r}")


def condition_fact_key(condition: dict[str, Any], perspective: str) -> str:
    """The key a leaf condition's declared answer goes under: the perspective, then the leaf's
    canonical JSON. Unit references such as ``this-unit`` name a different unit from each
    perspective, so the perspective is part of the key."""
    return f"{perspective}:{canonical_json(condition)}"


def condition_needs(
    condition: dict[str, Any],
    perspective: str,
    evaluate: Callable[[dict[str, Any]], Any],
) -> list[ConditionNeed]:
    """The leaves of ``condition`` that leave it undecided, deduplicated by key in first-seen
    order. ``evaluate`` is the engine's evaluator; a compound recurses into each operand that
    evaluates ``"unknown"``, so an ``and`` already decided by a false operand contributes
    nothing."""
    out: list[ConditionNeed] = []
    seen: set[str] = set()

    def visit(node: dict[str, Any]) -> None:
        if evaluate(node) != "unknown":
            return
        if isinstance(node.get("operator"), str) and isinstance(node.get("operands"), list):
            for operand in node["operands"]:
                if isinstance(operand, dict):
                    visit(operand)
            return
        key = condition_fact_key(node, perspective)
        if key in seen:
            return
        seen.add(key)
        out.append({"key": key, "condition": node, "perspective": perspective})

    visit(condition)
    return out


def _json_str(s: str) -> str:
    """``JSON.stringify`` of a string: a lone surrogate is escaped, everything else non-ASCII
    stays as is."""
    text = json.dumps(s, ensure_ascii=False)
    return _SURROGATE.sub(lambda m: f"\\u{ord(m.group()):04x}", text)


def _js_number(x: float) -> str:
    """``JSON.stringify`` of a number (ECMA-262 Number::toString on the shortest round-trip
    digits; non-finite prints ``null``)."""
    if not math.isfinite(x):
        return "null"
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    mantissa, _, exp = repr(abs(x)).partition("e")
    whole, _, frac = mantissa.partition(".")
    digits = whole + frac
    # Decimal point position relative to the start of `digits`: value = 0.digits × 10^n.
    n = len(whole) + (int(exp) if exp else 0)
    stripped = digits.lstrip("0")
    n -= len(digits) - len(stripped)
    digits = stripped.rstrip("0")
    k = len(digits)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    tail = "." + digits[1:] if k > 1 else ""
    return f"{sign}{digits[0]}{tail}e{'+' if e >= 0 else '-'}{abs(e)}"
