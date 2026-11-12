"""Task-level Harness² recursion for Filey: observe, isolate a contrast, reflect.

The executor is the normal Filey agent. This module watches one turn's tool results
and, at the end of the turn, looks for the one shape Harness² can learn from without
ground truth: a single failed action followed by a successful retry. If exactly one
thing changed — one argument or the choice of tool — that change becomes a candidate
lesson. Two changes are confounded and produce nothing.

The pre-turn library brief and the live probe after a failure are both data blocks,
never instructions: they ride the current user message or the tool result, so the
conversation's system prompt and its cache stay byte-stable.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

from filey_constants import filey_home_key

from .library import (
    MAX_CUE,
    MAX_EVIDENCE,
    MAX_LESSON,
    component_for_tool,
    domain_for,
    hint_for,
)


_TURNS: dict[tuple[str, str, str], TurnState] = {}
_LOCK = threading.RLock()
_MAX_STEPS = 80
_MAX_STATE = 128
_SECRET_KEY = re.compile(r"(?:password|passcode|secret|token|api[-_]?key|private[-_]?key)", re.IGNORECASE)
_PII_VALUE = re.compile(r"@|https?://|\b\d{9,}\b")


@dataclass
class Step:
    tool: str
    args: dict[str, Any]
    status: str = "ok"
    error: str = ""
    error_type: str = ""


@dataclass
class TurnState:
    session_id: str
    turn_id: str
    request: str
    domain: str
    shown: list[str] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)
    hinted: set[str] = field(default_factory=set)
    started: float = field(default_factory=time.time)


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "\n".join(parts)
    return ""


def _key(session_id: Any, turn_id: Any) -> tuple[str, str, str]:
    # One process serves many profiles; the profile home is part of the identity so a
    # coincident session id cannot borrow another tenant's in-flight turn.
    return filey_home_key(), str(session_id or ""), str(turn_id or "")


def _prune_locked() -> None:
    if len(_TURNS) <= _MAX_STATE:
        return
    oldest = sorted(_TURNS.items(), key=lambda item: item[1].started)[: len(_TURNS) - _MAX_STATE]
    for key, _ in oldest:
        _TURNS.pop(key, None)


def begin_turn(*, session_id: str, turn_id: str, request: Any, shown: Iterable[str]) -> TurnState:
    key = _key(session_id, turn_id)
    text = _text(request)
    additions = [str(item) for item in shown]
    with _LOCK:
        state = _TURNS.get(key)
        if state is None:
            state = TurnState(
                session_id=str(session_id or ""),
                turn_id=str(turn_id or ""),
                request=text,
                domain=domain_for(text),
                shown=additions,
            )
            _TURNS[key] = state
            _prune_locked()
            return state
        # A provider retry re-enters the same turn: keep the tool trajectory and the
        # lessons already shown, but let the latest request text win.
        state.request = text or state.request
        state.domain = domain_for(state.request)
        state.shown = list(dict.fromkeys([*state.shown, *additions]))
        return state


def record_tool(
    *, session_id: str, turn_id: str, tool: str, args: Any, status: str,
    error: str = "", error_type: str = "",
) -> None:
    key = _key(session_id, turn_id)
    with _LOCK:
        state = _TURNS.get(key)
        if state is None:
            state = TurnState(
                session_id=str(session_id or ""),
                turn_id=str(turn_id or ""),
                request="",
                domain="general",
            )
            _TURNS[key] = state
            _prune_locked()
        state.steps.append(Step(
            tool=str(tool or ""),
            args=dict(args) if isinstance(args, dict) else {},
            status=str(status or "ok"),
            error=str(error or "")[:400],
            error_type=str(error_type or "")[:80],
        ))
        if len(state.steps) > _MAX_STEPS:
            del state.steps[: len(state.steps) - _MAX_STEPS]


def probe_hint(*, session_id: str, turn_id: str, tool: str, status: str) -> str:
    """One short reminder after a failing tool call; never for a success."""
    if str(status or "ok") == "ok":
        return ""
    key = _key(session_id, turn_id)
    with _LOCK:
        state = _TURNS.get(key)
        if state is None:
            return ""
        if tool in state.hinted:
            return ""
        text, lesson_id = hint_for(state.request, tool, skip=state.hinted)
        if not text:
            return ""
        state.hinted.add(tool)
        if lesson_id:
            state.hinted.add(lesson_id)
    return text


def finish_turn(*, session_id: str, turn_id: str) -> TurnState | None:
    with _LOCK:
        return _TURNS.pop(_key(session_id, turn_id), None)


def drop_session(session_id: str) -> None:
    sid = str(session_id or "")
    with _LOCK:
        for key in [key for key in _TURNS if key[1] == sid]:
            _TURNS.pop(key, None)


def _json_error(content: Any) -> str:
    if not isinstance(content, str):
        return ""
    try:
        parsed = json.loads(content)
    except (ValueError, TypeError):
        return ""
    if isinstance(parsed, dict) and parsed.get("error"):
        return str(parsed["error"])
    return ""


def _call_name(tc: Any) -> str:
    function = tc.get("function") if isinstance(tc, dict) else getattr(tc, "function", None)
    if isinstance(function, dict):
        return str(function.get("name") or "")
    return str(getattr(function, "name", "") or "")


def _call_args(tc: Any) -> dict[str, Any]:
    function = tc.get("function") if isinstance(tc, dict) else getattr(tc, "function", None)
    raw = function.get("arguments") if isinstance(function, dict) else getattr(function, "arguments", None)
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def _call_id(tc: Any) -> str:
    if isinstance(tc, dict):
        return str(tc.get("id") or "")
    return str(getattr(tc, "id", "") or "")


def steps_from_history(messages: Iterable[Any]) -> list[Step]:
    """Fallback observation for a turn whose post_tool hooks did not run."""
    pending: list[tuple[str, str, dict[str, Any]]] = []
    steps: list[Step] = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role == "assistant":
            for tc in message.get("tool_calls") or []:
                pending.append((_call_id(tc), _call_name(tc), _call_args(tc)))
        elif role == "tool":
            tool = str(message.get("name") or "")
            tool_call_id = str(message.get("tool_call_id") or "")
            match = next((index for index, item in enumerate(pending) if tool_call_id and item[0] == tool_call_id), None)
            if match is None:
                match = next((index for index, item in enumerate(pending) if item[1] == tool), 0 if pending else None)
            if match is None or match >= len(pending):
                continue
            _, name, args = pending.pop(match)
            content = message.get("content")
            error = _json_error(content)
            if not error and isinstance(content, str) and re.match(r"\s*(?:error|failed|exception)\b", content, re.IGNORECASE):
                error = content
            steps.append(Step(
                tool=name or tool,
                args=args,
                status="error" if error else "ok",
                error=str(error)[:400],
            ))
    return steps


def recurred_components(steps: Iterable[Step], *, answered: bool = True) -> set[str]:
    """Failures that stayed unresolved, not a failure the agent then fixed.

    A failure followed by a successful retry is the contrast the harness learns from;
    counting it as a recurrence would punish the very lesson that worked.
    """
    steps = list(steps)
    if not answered:
        return {component_for_tool(step.tool) for step in steps if step.status != "ok"}
    out: set[str] = set()
    for index, step in enumerate(steps):
        if step.status == "ok":
            continue
        if not any(later.status == "ok" for later in steps[index + 1:]):
            out.add(component_for_tool(step.tool))
    return out


def _safe_value(key: str, value: Any) -> str:
    """A short, non-secret example from a corrected argument; empty when unsafe."""
    if _SECRET_KEY.search(str(key)):
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if not isinstance(value, (str, int, float)):
        return ""
    text = str(value).strip()
    if not text or len(text) > 40 or _PII_VALUE.search(text):
        return ""
    return text


def _changed_keys(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    keys = set(before) | set(after)
    return sorted(key for key in keys if before.get(key) != after.get(key))


def _error_label(step: Step) -> str:
    # The adapter's message ("bad date", "field is required") is more useful than the
    # exception class; fall back to the class when the message is empty.
    raw = (step.error or step.error_type or "").strip()
    raw = re.sub(r"https?://\S+", "a link", raw)
    raw = re.sub(r"\b[\w.+-]+@[\w.-]+\.\w{2,}\b", "an address", raw)
    raw = re.sub(r"\s+", " ", raw)
    return raw[:90] or "an error"


def extract_lesson(state: TurnState, steps: list[Step], *, answered: bool) -> dict[str, Any] | None:
    """One isolated failure→success contrast, or None (NO_ENTRY)."""
    if not answered or not steps:
        return None
    errors = [index for index, step in enumerate(steps) if step.status != "ok"]
    if len(errors) != 1:
        return None
    failed_at = errors[0]
    success = next((step for step in steps[failed_at + 1:] if step.status == "ok"), None)
    if success is None:
        return None
    failed = steps[failed_at]
    if not failed.tool or not success.tool:
        return None
    domain = state.domain or domain_for(state.request)
    article = "an" if domain in {"invoice", "office"} else "a"
    error_label = _error_label(failed)
    cue = f"When `{failed.tool}` fails with {error_label} on {article} {domain} task"
    cue = cue[:MAX_CUE]
    evidence_prefix = f"`{failed.tool}` returned {error_label}; "

    if failed.tool == success.tool:
        changed = _changed_keys(failed.args, success.args)
        if len(changed) > 1:
            return None  # two component edits behind one rollout: confounded
        if len(changed) == 1:
            key = changed[0]
            value = _safe_value(key, success.args.get(key))
            lesson = f"Correct `{key}` before retrying `{failed.tool}`"
            lesson += f" (for example, `{value}`)." if value else "."
            evidence = evidence_prefix + f"the corrected `{failed.tool}` call succeeded."
            confidence = "medium"
        else:
            lesson = f"Retry `{failed.tool}` once before changing the plan; the identical retry succeeded."
            evidence = evidence_prefix + f"an identical `{failed.tool}` retry succeeded."
            confidence = "low"
    else:
        lesson = f"When `{failed.tool}` fails on {article} {domain} task, use `{success.tool}`."
        evidence = evidence_prefix + f"the later `{success.tool}` call succeeded."
        confidence = "medium"

    return {
        "domain": domain,
        "component": component_for_tool(failed.tool),
        "cue": cue,
        "lesson": lesson[:MAX_LESSON],
        "evidence": evidence[:MAX_EVIDENCE],
        "confidence": confidence,
    }
