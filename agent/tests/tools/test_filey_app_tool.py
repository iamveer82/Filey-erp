"""Filey app bridge: tool payloads, the probe ladder, and which sessions get the toolset."""

import json

from tools import filey_app_tool
from tui_gateway import filey_app_bridge, server


def test_run_sends_exact_name_and_args_and_passes_the_answer_through():
    seen = []
    answer = json.dumps({"ok": True, "id": 7, "number": "INV-0007", "total": 105})
    out = filey_app_tool.filey_run_tool(
        name=" create_invoice_draft ", args='{"customer_name": "Acme", "items": []}',
        callback=lambda payload: seen.append(payload) or answer)
    assert seen == [{"op": "run", "name": "create_invoice_draft", "args": {"customer_name": "Acme", "items": []}}]
    assert json.loads(out)["number"] == "INV-0007"


def test_without_a_filey_app_the_tools_refuse_instead_of_guessing():
    assert "Filey app" in json.loads(filey_app_tool.filey_run_tool(name="x", args={}))["error"]
    assert "args must be" in json.loads(filey_app_tool.filey_run_tool(name="x", args=[1], callback=lambda p: "{}"))["error"]


def test_first_run_probes_with_catalog_then_runs_with_the_long_deadline(monkeypatch):
    calls = []

    def fake_ask(method, sid, params, timeout=300):
        calls.append((params["op"], timeout))
        return json.dumps({"ok": True})

    monkeypatch.setattr(server, "_ask", fake_ask)
    monkeypatch.setitem(server._sessions, "s1", {})
    filey_app_bridge.request("s1", {"op": "run", "name": "create_invoice_draft", "args": {}})
    assert calls == [("catalog", filey_app_bridge._PROBE_TIMEOUT_S), ("run", filey_app_bridge._RUN_TIMEOUT_S)]


def test_unanswered_probe_fails_fast_for_the_rest_of_the_session(monkeypatch):
    calls = []
    monkeypatch.setattr(server, "_ask", lambda *a, **k: calls.append(a) or "")
    monkeypatch.setitem(server._sessions, "s2", {})
    assert filey_app_bridge.request("s2", {"op": "catalog"}) == filey_app_bridge.UNAVAILABLE
    assert filey_app_bridge.request("s2", {"op": "run", "name": "x", "args": {}}) == filey_app_bridge.UNAVAILABLE
    assert len(calls) == 1


def test_only_filey_app_sessions_carry_the_filey_toolset():
    assert "filey_app" in server._gui_surface_toolsets("filey")
    assert "filey_app" not in server._gui_surface_toolsets("desktop")
    assert "filey_app" not in server._gui_surface_toolsets("cli")


def test_filey_app_sessions_get_the_lean_kit_without_host_access(monkeypatch):
    from toolsets import resolve_toolset

    monkeypatch.delenv("FILEY_TUI_TOOLSETS", raising=False)
    assert server._load_enabled_toolsets("filey") == ["filey-app-session"]
    tools = set(resolve_toolset("filey-app-session"))
    assert {"filey_tools", "filey_run", "memory", "web_search"} <= tools
    assert not tools & {"terminal", "read_file", "write_file", "patch", "browser_exec", "execute_code", "computer_use"}
