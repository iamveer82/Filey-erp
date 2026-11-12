"""The app closing first leaves the engine's stderr dead; on Windows the exit note then raised
OSError 22 inside ``_log_exit`` and every shutdown ended in an unhandled exception."""
from tui_gateway import entry


class _DeadPipe:
    def write(self, _text):
        raise OSError(22, "Invalid argument")

    def flush(self):
        raise OSError(22, "Invalid argument")


def test_exit_note_survives_a_closed_stderr(monkeypatch):
    monkeypatch.setattr(entry, "_append_crash_log", lambda *a, **kw: None)
    monkeypatch.setattr(entry.sys, "stderr", _DeadPipe())
    entry._log_exit("stdin EOF (peer closed)")  # must not raise
