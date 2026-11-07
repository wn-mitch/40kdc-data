"""A weapon a selection binds by name, written into the scopes that refer to it.

A ``select-weapon`` step that names the weapon it binds (``weapons.name``) is resolved before
translation: every later ``weapons.ref`` naming its ``bind_as`` variable, in the same sequence or
nested under it, takes the selection's weapon scope, and the selection step is dropped. A model
holds one weapon of a name in nearly every loadout, so the named scope is the selected weapon. A
selection that does not name its weapon is the player's choice among several and stays bound.
"""

from __future__ import annotations

from typing import Any


def _named_binding(step: Any) -> tuple[str, dict[str, Any]] | None:
    """The weapon scope a selection binds by name, or None when it does not name its weapon."""
    if not isinstance(step, dict) or step.get("type") != "select-weapon":
        return None
    modifier = step.get("modifier")
    if not isinstance(modifier, dict):
        return None
    variable = modifier.get("bind_as")
    scope = modifier.get("weapons")
    if not isinstance(variable, str) or not isinstance(scope, dict):
        return None
    if not isinstance(scope.get("name"), str) or "ref" in scope:
        return None
    return variable, scope


def _substituted(
    scope: dict[str, Any], bindings: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    """A ``weapons.ref`` naming a bound variable, replaced by the bound scope."""
    ref = scope.get("ref")
    if not isinstance(ref, dict) or len(ref) != 1 or not isinstance(ref.get("weapon_var"), str):
        return None
    bound = bindings.get(ref["weapon_var"])
    if bound is None:
        return None
    rest = {key: value for key, value in scope.items() if key != "ref"}
    return {**rest, **bound}


def _resolve(node: Any, bindings: dict[str, dict[str, Any]]) -> Any:
    if isinstance(node, list):
        return [_resolve(child, bindings) for child in node]
    if not isinstance(node, dict):
        return node
    out: dict[str, Any] = {}
    for key, value in node.items():
        if key == "steps" and node.get("type") == "sequence" and isinstance(value, list):
            local = dict(bindings)
            steps: list[Any] = []
            for step in value:
                binding = _named_binding(step)
                if binding is not None:
                    local[binding[0]] = binding[1]
                else:
                    steps.append(_resolve(step, local))
            out[key] = steps
        elif key == "weapons" and isinstance(value, dict):
            replaced = _substituted(value, bindings)
            out[key] = replaced if replaced is not None else _resolve(value, bindings)
        else:
            out[key] = _resolve(value, bindings)
    return out


def resolve_named_weapon_bindings(effect: Any) -> Any:
    """The effect with each weapon a selection binds by name written into the scopes naming it."""
    return _resolve(effect, {})
