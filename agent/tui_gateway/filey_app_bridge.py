"""Filey ERP app bridge: the ``filey.tool`` server request behind ``tools/filey_app_tool.py``.

The Filey app (web tab or desktop window) connected to this session owns every business tool:
it runs them through its own ``runTool`` so workspace scope, module access, capability switches and
approval prompts are the app's — the agent never re-implements invoice math or posting rules.

Probe ladder (same shape as ``_tour_request``): until the session's client has answered once, a
request gets a short deadline, so a client that is not the Filey app (TUI, an older build) fails
fast instead of stalling the turn. A ``run`` can wait on the user's approval card, hence the long
answered deadline.
"""

from __future__ import annotations

import json

# The client answers ``catalog`` from memory; anything slower than this is not a Filey app.
_PROBE_TIMEOUT_S = 15
# A run may sit behind an approval card the user has to read.
_RUN_TIMEOUT_S = 600
_CATALOG_TIMEOUT_S = 30

UNAVAILABLE = json.dumps({
    "success": False,
    "error": ("No Filey app is connected to this chat, so Filey ERP data and actions are out of reach. "
              "Ask the user to open Filey (web or desktop) and chat from its Filey AI page, then retry. "
              "Do not retry filey tools again in this session until the user says the app is open.")})


def request(sid: str, payload: dict) -> str:
    """Send one ``filey.tool`` request for *sid*; JSON text answer or :data:`UNAVAILABLE`."""
    from tui_gateway import server

    session = server._sessions.get(sid)
    if session is None:  # detached caller: throwaway record, unprobed
        session = {}
    state = session.get("filey_app_bridge")
    if state == "unanswered":
        return UNAVAILABLE
    if state != "answered":
        # Prove the client is a Filey app with a cheap catalog read, so a first ``run`` that waits on an
        # approval card is never cut off by the probe deadline.
        probe = payload if payload.get("op") == "catalog" else {"op": "catalog"}
        answer = server._ask("filey.tool", sid, dict(probe), timeout=_PROBE_TIMEOUT_S)
        session["filey_app_bridge"] = "answered" if answer else "unanswered"
        if not answer:
            return UNAVAILABLE
        if probe is payload:
            return answer
    timeout = _RUN_TIMEOUT_S if payload.get("op") == "run" else _CATALOG_TIMEOUT_S
    return server._ask("filey.tool", sid, dict(payload), timeout=timeout) or json.dumps({
        "success": False,
        "error": ("The Filey app did not answer (closed, reloaded or the request was cancelled). If this was a "
                  "write, it may still have completed: read the record back before trying again.")})
