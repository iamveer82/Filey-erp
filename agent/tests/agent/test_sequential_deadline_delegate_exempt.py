"""``delegate_task`` runs a nested orchestrator's whole batch inside one tool call by design, so it must not
sit under the generic sequential-call deadline: with it, every batch longer than the deadline "timed out"
while its children kept running as orphans and the orchestrator polled transcripts for hours."""
from agent import tool_executor as te

def test_delegate_task_is_exempt_from_the_sequential_deadline():
    assert "delegate_task" in te._SEQUENTIAL_DEADLINE_EXEMPT_TOOLS


def test_filey_app_tools_leave_their_deadline_to_the_app_bridge(monkeypatch):
    """Their approval card lives in the app, out of the engine's human-wait clock: under the generic
    deadline a slow OK (or a long OCR) timed out with the card still open."""
    import tools.filey_app_tool as fat
    monkeypatch.setitem(fat.FILEY_NATIVE_TOOLS, "pdf", "pdf")
    assert te._runs_in_filey_app("filey_run")
    assert te._runs_in_filey_app("pdf")
    assert not te._runs_in_filey_app("terminal")
