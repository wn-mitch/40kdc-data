"""Per-stage buff attribution by leave-one-out (LOO) recompute.

The engine is closed-form, so the honest way to answer "how much did this
buff lift this stage?" is to re-run :func:`~wh40kdc.cruncher.engine.crunch`
with that buff removed and diff the stage value. LOO is exactly correct
through every non-linearity the pipeline has, and it respects the resolver's
non-additive rules for free.

Only *toggleable* buffs are attributed — abilities and manual UI toggles. The
weapon's intrinsic keywords are auto-injected inside ``crunch``, are not
levers, and are never removed; they're reported by id in ``intrinsics``.

Python mirror of ``tools/src/cruncher/attribution.ts``. Lift order
(first-seen group order) is a conformance contract.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.cruncher.buffs import BuffSource
from wh40kdc.cruncher.engine import EngineInput, crunch
from wh40kdc.data.dataset import Dataset

_DEFAULT_EPSILON = 1e-6


def _is_groupable(source: BuffSource) -> bool:
    """Buffs the UI toggles on/off — the only kinds we attribute."""
    return source.get("kind") in ("ability", "manual")


def _group_key(source: BuffSource) -> str:
    """Stable grouping key. Every buff a single UI toggle flatMaps to shares
    one key, so a LOO pass removes the whole toggle, never a fragment."""
    kind = source.get("kind")
    if kind == "ability":
        return f"a:{source.get('abilityId')}:{source.get('sourceUnitId') or ''}"
    if kind == "manual":
        return f"m:{source.get('label')}"
    return f"w:{source.get('weaponId')}:{source.get('keywordId')}"


def attribute_stages(
    input: EngineInput,
    dataset: Dataset | None = None,
    *,
    epsilon: float = _DEFAULT_EPSILON,
) -> list[dict[str, Any]]:
    """Decompose each pipeline stage of ``crunch(input)`` into the marginal
    lift of every toggleable buff group, via leave-one-out recompute.

    Cost is ``groups + 2`` crunch calls (full + baseline + one per group).
    Lifts/residuals at or below ``epsilon`` magnitude are treated as zero.
    """
    full = crunch(input, dataset)
    buffs = input.get("buffs", [])

    # First-seen order of groupable buff groups, with a representative source.
    order: list[str] = []
    rep_source: dict[str, BuffSource] = {}
    for b in buffs:
        if not _is_groupable(b["source"]):
            continue
        key = _group_key(b["source"])
        if key not in rep_source:
            rep_source[key] = b["source"]
            order.append(key)

    # Baseline keeps only non-groupable buffs (weapon-keyword passthroughs)
    # plus the engine's auto-injected intrinsics.
    baseline = crunch(
        {**input, "buffs": [b for b in buffs if not _is_groupable(b["source"])]},
        dataset,
    )

    # Leave-one-out: drop one whole group, keep the rest.
    loo: dict[str, dict[str, Any]] = {}
    for key in order:
        without = [
            b for b in buffs if not _is_groupable(b["source"]) or _group_key(b["source"]) != key
        ]
        loo[key] = crunch({**input, "buffs": without}, dataset)

    intrinsics = [e["keywordRef"]["keyword_id"] for e in full["resolved"]["extraKeywords"]]

    # crunch always emits the same seven stages in the same order, so index
    # alignment across full / baseline / loo is sound.
    out: list[dict[str, Any]] = []
    for i, s in enumerate(full["stages"]):
        expected = s["expected"]
        base_expected = baseline["stages"][i]["expected"]
        total_lift = 0.0
        lifts: list[dict[str, Any]] = []
        for key in order:
            delta = expected - loo[key]["stages"][i]["expected"]
            total_lift += delta
            if abs(delta) > epsilon:
                lifts.append({"source": rep_source[key], "delta": delta})
        residual = expected - base_expected - total_lift
        out.append(
            {
                "name": s["name"],
                "expected": expected,
                "detail": s["detail"],
                "baseline": base_expected,
                "lifts": lifts,
                "residual": residual if abs(residual) > epsilon else 0,
                "intrinsics": intrinsics,
            }
        )
    return out
