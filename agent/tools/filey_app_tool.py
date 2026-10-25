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


def filey_run_tool(name: str = "", args: Any = None, callback: Optional[Callable] = None) -> str:
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
    try:
        return passthrough_json(callback({"op": "run", "name": tool, "args": args}))
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
