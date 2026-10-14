"""The one expiry vocabulary (scope.duration, ability-part.duration, designate.clears_on,
the designation containers) as the trailing clause that says when an effect ends.
``one-use`` and ``permanent`` add no trail; ``one-use`` leads the sentence instead.

Python mirror of ``tools/src/translate/expiry.ts``.
"""

from __future__ import annotations

from typing import Any

_TRAILS: dict[str, str] = {
    "attack-sequence": "until that unit finishes resolving its attacks",
    "resolution": "when resolving this use",
    "phase": "until the end of the phase",
    "turn": "until the end of the turn",
    "battle": "for the rest of the battle",
    "battle-round": "until the end of the battle round",
    "until-next-command-phase": "until the start of your next Command phase",
    "until-next-movement-phase": "until the start of your next Movement phase",
    "until-next-shooting-phase": "until the start of your next Shooting phase",
    "until-next-battle-round": "until the start of the next battle round",
    "until-start-next-turn": "until the start of your next turn",
    "until-end-of-your-next-turn": "until the end of your next turn",
    "until-end-of-opponent-next-turn": "until the end of your opponent's next turn",
    "until-this-unit-has-shot": "until this unit has resolved its ranged attacks",
    "control-lost": "until you no longer control it",
}


def expiry_trail(duration: Any) -> str:
    """The trailing clause for an expiry, or "" when it adds none."""
    return _TRAILS.get(duration, "") if isinstance(duration, str) else ""
