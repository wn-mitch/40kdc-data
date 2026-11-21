"""Detachment and shared-keyword gates on conditional leader-attachment groups (mirror of TS
``attachmentGatesHold`` in ``tools/src/data/dataset-attachments.ts``)."""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping
from typing import Any

from wh40kdc.data.dataset import (
    Dataset,
    _conditional_group_applies,
    _matches_bodyguard_keywords,
)


def _group_gates_hold(
    group: Mapping[str, Any],
    detachment_ids: Collection[str],
    leader_has: Callable[[str], bool],
    bodyguard_has: Callable[[str], bool],
) -> bool:
    """Whether a group's required detachment is selected, its excluded detachment is not, and
    both the leader and the bodyguard carry its required shared keyword."""
    required = group.get("required_detachment_id")
    if required is not None and required not in detachment_ids:
        return False
    excluded = group.get("excluded_detachment_id")
    if excluded is not None and excluded in detachment_ids:
        return False
    keyword = group.get("required_shared_keyword")
    return keyword is None or (leader_has(keyword) and bodyguard_has(keyword))


def attachment_gates_hold(
    dataset: Dataset,
    leader_id: str,
    bodyguard_id: str,
    roster_unit_ids: set[str],
    detachment_ids: Collection[str],
    leader_has: Callable[[str], bool],
    bodyguard_has: Callable[[str], bool],
) -> bool:
    """Whether ``leader_id`` may join ``bodyguard_id`` under the roster's detachment and
    shared-keyword gates.

    True when an unconditional id or keyword clause admits the bodyguard, or a roster-applicable
    conditional group listing it has its gates hold; False when every such group fails a gate. A
    bodyguard no group lists is True here (eligibility itself is checked elsewhere).
    """
    bodyguard = dataset.units.get_any(bodyguard_id)
    gated = False
    for la in dataset.leader_attachments:
        if la.get("leader_id") != leader_id:
            continue
        if bodyguard_id in (la.get("eligible_bodyguard_ids") or []):
            return True
        if bodyguard is not None and _matches_bodyguard_keywords(la, bodyguard.raw):
            return True
        for group in la.get("conditional_groups") or []:
            if bodyguard_id not in (group.get("eligible_bodyguard_ids") or []):
                continue
            if not _conditional_group_applies(group, roster_unit_ids):
                continue
            if _group_gates_hold(group, detachment_ids, leader_has, bodyguard_has):
                return True
            gated = True
    return not gated
