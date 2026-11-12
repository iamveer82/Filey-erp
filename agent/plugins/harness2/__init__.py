"""Harness² for Filey: recursive, evidence-graded self-improvement.

The plugin turns every real Filey turn into a small experiment:

* At the start of a turn, `pre_llm_call` appends the domain's best lessons to the
  current user message (never the system prompt), so the cache prefix stays stable.
* `post_tool_call` records the trajectory. A failing result gets one short probe
  hint in `transform_tool_result`: change one thing before retrying.
* At the end of the turn, `post_llm_call` grades the lessons that were shown and
  retains at most one new lesson from an isolated failure→success contrast. A
  guess, a secret, or a two-change rollout writes nothing.

The model weights never change; the improvement harness does. Storage is the
active profile's `harness/library.json`, so profiles and tenants stay separate.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict
from typing import Any

from . import library, reflect

logger = logging.getLogger(__name__)


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(
            item if isinstance(item, str) else str(item.get("text") or "")
            for item in value
            if isinstance(item, (str, dict))
        )
    return ""


def _on_pre_llm_call(
    *, session_id: str = "", turn_id: str = "", user_message: Any = None,
    conversation_history: Any = None, is_first_turn: bool = False, **_: Any,
) -> dict[str, str] | None:
    """Attach the adopted harness for this kind of work to the current user turn."""
    try:
        request = _text(user_message)
        if not request.strip() or request.lstrip().startswith("/"):
            return None
        text, shown = library.brief(request)
        reflect.begin_turn(
            session_id=session_id,
            turn_id=turn_id,
            request=request,
            shown=shown,
        )
        if not text:
            return None
        logger.debug("harness2: %d lesson(s) attached for %s", len(shown), request[:80])
        return {"context": text}
    except Exception as exc:  # never break a live turn for the harness
        logger.debug("harness2 pre_llm_call failed: %s", exc, exc_info=True)
        return None


def _on_post_tool_call(
    *, tool_name: str = "", args: Any = None, status: str = "ok",
    error_type: str = "", error_message: str = "", session_id: str = "",
    turn_id: str = "", **_: Any,
) -> None:
    try:
        reflect.record_tool(
            session_id=session_id,
            turn_id=turn_id,
            tool=tool_name,
            args=args,
            status=status,
            error=str(error_message or "") or str(error_type or ""),
            error_type=error_type,
        )
    except Exception as exc:
        logger.debug("harness2 post_tool_call failed: %s", exc, exc_info=True)


def _on_transform_tool_result(
    *, tool_name: str = "", result: Any = None, status: str = "ok",
    session_id: str = "", turn_id: str = "", **_: Any,
) -> str | None:
    """Append one targeted lesson after a failure; a success is never decorated."""
    try:
        if status == "ok" or not isinstance(result, str):
            return None
        hint = reflect.probe_hint(
            session_id=session_id,
            turn_id=turn_id,
            tool=tool_name,
            status=status,
        )
        if not hint:
            return None
        return result + hint
    except Exception as exc:
        logger.debug("harness2 transform_tool_result failed: %s", exc, exc_info=True)
        return None


def _on_post_llm_call(
    *, session_id: str = "", turn_id: str = "", user_message: Any = None,
    assistant_response: Any = None, conversation_history: Any = None, **_: Any,
) -> None:
    """Harnessing-level recursion: grade what was shown, then retain one contrast."""
    try:
        state = reflect.finish_turn(session_id=session_id, turn_id=turn_id)
        request = _text(user_message)
        if state is None:
            state = reflect.TurnState(
                session_id=str(session_id or ""),
                turn_id=str(turn_id or ""),
                request=request,
                domain=library.domain_for(request),
            )
        steps = state.steps or reflect.steps_from_history(conversation_history or [])
        answered = bool(str(assistant_response or "").strip())
        recurred = reflect.recurred_components(steps, answered=answered)
        used = {library.component_for_tool(step.tool) for step in steps}
        library.grade(
            state.shown, answered=answered,
            recurred_components=recurred, used_components=used,
        )
        if not answered:
            return
        draft = reflect.extract_lesson(state, steps, answered=True)
        if draft is not None:
            kept = library.retain(draft, shown=state.shown)
            if kept is not None:
                logger.info("harness2: retained a %s lesson for %s", kept.component, kept.domain)
    except Exception as exc:  # a reflection must never fail the turn
        logger.debug("harness2 post_llm_call failed: %s", exc, exc_info=True)


def _on_session_end(*, session_id: str = "", **_: Any) -> None:
    reflect.drop_session(session_id)


_TOOL_SCHEMA = {
    "name": "harness_lessons",
    "description": (
        "Inspect, export or forget the evidence-graded lessons the Harness² self-improvement "
        "plugin learned from earlier tasks. Lessons are domain-scoped and only written after "
        "an isolated failure→success contrast. Use `list` to answer what you have learned, "
        "`stats` for a summary, and `forget` only when the user asks to drop a bad lesson."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list", "stats", "forget", "clear"]},
            "domain": {
                "type": "string",
                "enum": list(library.DOMAINS),
                "description": "list: only this kind of work.",
            },
            "id": {"type": "string", "description": "forget: the lesson id from list."},
            "confirm": {"type": "boolean", "description": "clear: true deletes every lesson."},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}


def _harness_tool(args: dict[str, Any]) -> dict[str, Any]:
    action = str(args.get("action") or "list")
    if action == "stats":
        return {"ok": True, **library.stats()}
    if action == "list":
        domain = args.get("domain")
        rows = library.load_lessons()
        if domain:
            rows = [item for item in rows if item.domain == domain]
        return {
            "ok": True,
            "count": len(rows),
            "lessons": [asdict(item) for item in rows],
            "text": library.render_list(domain=str(domain) if domain else None),
        }
    if action == "forget":
        lesson_id = str(args.get("id") or "")
        forgot = library.forget(lesson_id)
        return {"ok": forgot, "id": lesson_id, "forgot": forgot}
    if action == "clear":
        if args.get("confirm") is not True:
            return {"ok": False, "error": "Pass confirm: true to delete every lesson."}
        return {"ok": True, "cleared": library.clear()}
    return {"ok": False, "error": "action must be list, stats, forget or clear."}


def _status_text() -> str:
    rows = library.stats()
    if not rows["total"]:
        return (
            "Harness² is on. No lessons yet.\n"
            "A lesson is written only after a real failure→success contrast isolates one change."
        )
    return (
        f"Harness² is on. {rows['total']} lesson(s) in {rows['path']}\n"
        f"confidence: {rows['high']} high · {rows['medium']} medium · {rows['low']} low\n"
        f"domains: {', '.join(f'{k}={v}' for k, v in sorted(rows['by_domain'].items()))}\n"
        f"components: {', '.join(f'{k}={v}' for k, v in sorted(rows['by_component'].items()))}"
    )


def _command(raw: str) -> str:
    argv = str(raw or "").split()
    action = argv[0].lower() if argv else "status"
    if action in {"status", "stats"}:
        return _status_text()
    if action == "list":
        domain = argv[1] if len(argv) > 1 else None
        return library.render_list(domain=domain)
    if action == "forget" and len(argv) > 1:
        return "Forgot that lesson." if library.forget(argv[1]) else "No lesson with that id."
    if action == "clear":
        if len(argv) < 2 or argv[1] not in {"yes", "confirm"}:
            return "Run `/harness clear yes` to delete every lesson."
        return f"Cleared {library.clear()} lesson(s)."
    if action == "export":
        return json.dumps({"lessons": [asdict(item) for item in library.load_lessons()]}, indent=2)
    return (
        "Usage: /harness [status|list [domain]|forget <id>|clear yes|export]\n"
        + _status_text()
    )


def _register_cli(subparser: Any) -> None:
    sub = subparser.add_subparsers(dest="harness_action")
    sub.add_parser("status", help="Show the harness library summary")
    list_cmd = sub.add_parser("list", help="List lessons, optionally for one domain")
    list_cmd.add_argument("domain", nargs="?")
    forget_cmd = sub.add_parser("forget", help="Delete one lesson by id")
    forget_cmd.add_argument("id")
    sub.add_parser("clear", help="Delete every lesson")
    sub.add_parser("export", help="Print the library as JSON")
    subparser.set_defaults(harness_action="status")


def _cli_command(args: Any) -> None:
    action = getattr(args, "harness_action", "status") or "status"
    if action == "list":
        print(library.render_list(domain=getattr(args, "domain", None)))
    elif action == "forget":
        print("Forgot that lesson." if library.forget(args.id) else "No lesson with that id.")
    elif action == "clear":
        print(f"Cleared {library.clear()} lesson(s).")
    elif action == "export":
        print(json.dumps({"lessons": [asdict(item) for item in library.load_lessons()]}, indent=2))
    else:
        print(_status_text())


def register(ctx) -> None:
    """Register the harness hooks, the /harness command and `filey harness`."""
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("transform_tool_result", _on_transform_tool_result)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_tool(
        "harness_lessons", "harness", _TOOL_SCHEMA, _harness_tool,
        description="Inspect or forget evidence-graded lessons from earlier tasks",
        emoji="🧠",
    )
    ctx.register_command(
        "harness",
        _command,
        description="Show, export or forget the evidence-graded lessons Harness² has learned",
        args_hint="[status|list [domain]|forget <id>|clear yes|export]",
    )
    ctx.register_cli_command(
        "harness",
        "Harness² self-improvement library (status, list, forget, export)",
        _register_cli,
        _cli_command,
        description=(
            "Inspect the persistent improvement harness. Lessons are learned only from an "
            "isolated failure→success contrast, never from a guess."
        ),
    )
