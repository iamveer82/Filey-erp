#!/usr/bin/env python3
"""Filey ERP business tools, executed by the connected Filey app.

Two tools stand in for the app's whole catalogue (invoices, quotes, purchase orders, customers,
products, stock, accounting, payroll, CRM, reports, documents, messaging, ...): ``filey_tools``
lists/describes them, ``filey_run`` runs one. The app runs each through its own ``runTool`` — the
code path its UI uses — so totals, numbering, posting, approvals and permissions are the app's.
Keeping two fixed tools (not one schema per app tool) leaves the cached prompt prefix stable and
the per-call tool payload small. Round-trips through ``tui_gateway/filey_app_bridge.py``.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from tools.desktop_ui import passthrough_json
from tools.registry import registry, tool_error


def filey_tools_tool(query: Optional[str] = None, name: Optional[str] = None,
                     callback: Optional[Callable] = None) -> str:
    """Catalogue of the app's tools: names + one-line purpose, or one tool's full schema."""
    if callback is None:
        return tool_error("Filey ERP tools are available when chatting from the Filey app (web or desktop).")
    payload: dict[str, Any] = {"op": "catalog"}
    if name and name.strip():
        payload["name"] = name.strip()
    if query and query.strip():
        payload["args"] = {"query": query.strip()}
    try:
        return passthrough_json(callback(payload))
    except Exception as exc:
        return tool_error(f"Failed to read the Filey tool catalogue: {exc}")


_SAVED_NOTE = ("Saved, not sent inline (it would cost far more context than the tree). Act from the tree or the "
               "page text first; if you really need to see it, call vision_analyze with image_url set to this path.")
_KEEP_SCREENSHOTS = 20


def _save_screenshot(mime: str, data: str) -> Optional[str]:
    """Write a capture to a small rolling folder (newest 20) and return its path."""
    import base64
    import tempfile
    import uuid
    from pathlib import Path

    folder = Path(tempfile.gettempdir()) / "filey-screens"
    try:
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{uuid.uuid4().hex}{'.jpg' if 'jp' in mime else '.png'}"
        path.write_bytes(base64.b64decode(data))
        for old in sorted(folder.iterdir(), key=lambda p: p.stat().st_mtime)[:-_KEEP_SCREENSHOTS]:
            old.unlink(missing_ok=True)
        return str(path)
    except (OSError, ValueError):
        return None


def _pop_images(value: Any, found: list[tuple[str, str]]) -> Any:
    """Copy of an app result with screenshot bytes lifted out into ``found`` (mime, base64)."""
    if isinstance(value, dict):
        data = value.get("dataBase64")
        if isinstance(data, str) and len(data) > 256:
            found.append((str(value.get("mediaType") or "image/png"), data))
            return {**{k: v for k, v in value.items() if k != "dataBase64"}, "attached": True}
        out: dict[str, Any] = {}
        for key, item in value.items():
            if key == "screenshotPngBase64" and isinstance(item, str) and len(item) > 256:
                found.append(("image/png", item))
                continue
            out[key] = _pop_images(item, found)
        return out
    if isinstance(value, list):
        return [_pop_images(item, found) for item in value]
    return value


def _embed(mime: str, data: str) -> tuple[str, Optional[str]]:
    """Data URL sized by the engine's own history budget, plus a coordinate note when it shrank."""
    import base64
    import os
    import tempfile
    from pathlib import Path

    from tools.vision_tools import _EMBED_MAX_DIMENSION, _build_scale_note, _resize_image_for_vision
    from tools.vision_tools_history_budget import resolve_embed_target_bytes

    suffix = ".jpg" if "jpeg" in mime or "jpg" in mime else ".png"
    handle, path = tempfile.mkstemp(prefix="filey-shot-", suffix=suffix)
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(base64.b64decode(data))
        scale: dict[str, Any] = {}
        url = _resize_image_for_vision(Path(path), mime_type=mime, max_base64_bytes=resolve_embed_target_bytes(),
                                       max_dimension=_EMBED_MAX_DIMENSION, scale_out=scale, force_jpeg=True)
        return url, _build_scale_note(scale or None, None)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _native_vision() -> bool:
    """Whether the main model takes images inside tool results (the engine's one gate)."""
    try:
        from tools.vision_tools import _should_use_native_vision_fast_path
        return bool(_should_use_native_vision_fast_path())
    except Exception:
        return False


def _app_result(raw: Any) -> Any:
    """The app's answer for the engine. Screenshots never travel as base64 text (one was ~200K
    characters of context the model re-read every request): a vision model gets them as real
    images through the multimodal envelope, any other model a one-line note instead."""
    text = passthrough_json(raw)
    if "dataBase64" not in text and "screenshotPngBase64" not in text:
        # Long lists (a 54-row tool catalogue, 51 files) are cut to their head, tail and odd rows.
        from tools.tool_output_crusher import crush_json_text
        return crush_json_text(text)
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return text
    found: list[tuple[str, str]] = []
    clean = _pop_images(data, found)
    if not found:
        return text
    if not _native_vision():
        # This model reads images only through vision_analyze (an extra, slower call): keep the
        # capture on disk and hand over its path instead of ~200K characters of base64.
        paths = [p for p in (_save_screenshot(mime, b64) for mime, b64 in found[:2]) if p]
        if isinstance(clean, dict):
            clean["screenshot"] = {"path": paths[0], "note": _SAVED_NOTE} if paths else "Screenshot could not be saved."
        return json.dumps(clean, ensure_ascii=False)
    summary = json.dumps(clean, ensure_ascii=False)
    parts: list[dict[str, Any]] = []
    notes: list[str] = []
    for mime, b64 in found[:2]:
        try:
            url, note = _embed(mime, b64)
        except Exception:
            url, note = f"data:{mime};base64,{b64}", None
        parts.append({"type": "image_url", "image_url": {"url": url}})
        if note:
            notes.append(note)
    lead = summary + "\n\nThe screenshot from this call is attached — inspect it with your native vision."
    if notes:
        lead += "\n" + notes[0]
    return {"_multimodal": True, "text_summary": summary, "content": [{"type": "text", "text": lead}, *parts]}


def filey_run_tool(name: str = "", args: Any = None, callback: Optional[Callable] = None) -> Any:
    """Run one app tool by exact name with its JSON arguments."""
    if callback is None:
        return tool_error("Filey ERP tools are available when chatting from the Filey app (web or desktop).")
    tool = (name or "").strip()
    if not tool:
        return tool_error("name is required: an exact tool name from filey_tools.")
    if isinstance(args, str):
        try:
            args = json.loads(args) if args.strip() else {}
        except json.JSONDecodeError as exc:
            return tool_error(f"args must be a JSON object: {exc}")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        return tool_error("args must be a JSON object matching the tool's parameters.")
    if tool == "computer_use" and not _native_vision() and str(args.get("action") or "").startswith("app_"):
        # A model without inline vision works from the app's tree: skip the capture unless it asks.
        args = {"include_screenshot": False, **args}
    try:
        return _app_result(callback({"op": "run", "name": tool, "args": args}))
    except Exception as exc:
        return tool_error(f"Failed to run {tool} in the Filey app: {exc}")


FILEY_TOOLS_SCHEMA = {
    "name": "filey_tools",
    "description": (
        "List the Filey ERP actions available in the user's Filey app (invoices, quotes, purchase "
        "orders, credit notes, payments, customers, suppliers, products/stock, accounting, VAT, "
        "payroll, CRM deals/leads, reports, letters, documents, reminders, messaging). Call with "
        "`query` (e.g. 'invoice', 'stock') to find candidates, then with `name` to get that tool's "
        "exact parameters before calling filey_run. Use these for ANY business data or action — "
        "never answer business figures from memory and never fabricate records."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Words to filter tools by name/purpose."},
            "name": {"type": "string", "description": "Exact tool name: returns its full parameter schema."},
        },
    },
}

FILEY_RUN_SCHEMA = {
    "name": "filey_run",
    "description": (
        "Run one Filey ERP action in the user's Filey app with arguments matching its schema from "
        "filey_tools. Writes (create/revise/send/pay) happen in the user's real workspace and may "
        "show the user an approval card. Report the figures the result returns (number, totals), "
        "not re-computed ones. If a result says a save is unconfirmed, read the record back before "
        "any retry — never create a duplicate."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Exact tool name from filey_tools, e.g. 'create_invoice_draft'."},
            "args": {"type": "object", "description": "Arguments object for that tool."},
        },
        "required": ["name", "args"],
    },
}


registry.register(
    name="filey_tools",
    toolset="filey_app",
    schema=FILEY_TOOLS_SCHEMA,
    handler=lambda args, **kw: filey_tools_tool(
        query=args.get("query"), name=args.get("name"), callback=kw.get("callback")),
    emoji="🧾")

registry.register(
    name="filey_run",
    toolset="filey_app",
    schema=FILEY_RUN_SCHEMA,
    handler=lambda args, **kw: filey_run_tool(
        name=args.get("name", ""), args=args.get("args"), callback=kw.get("callback")),
    emoji="🧾")


# Filey's everyday tools as this agent's OWN tools (Office apps, the computer, files, the core
# books), with the app's exact schemas: behind filey_tools the agent reached for its terminal and
# Python instead. The manifest is generated from the app (src/lib/fileyHermesTools.ts).
def _load_native_manifest() -> list[dict]:
    import os
    path = os.path.join(os.path.dirname(__file__), "filey_app_manifest.json")
    try:
        with open(path, encoding="utf-8") as handle:
            rows = json.load(handle)
    except (OSError, ValueError):
        return []
    return [row for row in rows if isinstance(row, dict) and row.get("hermes_name") and row.get("name")]


#: Engine tool name -> the app's tool name (they differ only where the engine has its own tool).
FILEY_NATIVE_TOOLS: dict[str, str] = {}

for _row in _load_native_manifest():
    FILEY_NATIVE_TOOLS[_row["hermes_name"]] = _row["name"]
    registry.register(
        name=_row["hermes_name"],
        toolset="filey_app",
        schema={"name": _row["hermes_name"], "description": _row.get("description", ""),
                "parameters": _row.get("parameters") or {"type": "object", "properties": {}}},
        handler=(lambda app_name: lambda args, **kw: filey_run_tool(
            name=app_name, args=dict(args or {}), callback=kw.get("callback")))(_row["name"]),
        emoji="🧾")
