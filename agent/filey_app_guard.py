"""Filey Agent runs only under the Filey desktop app.

The engine itself (``python -m tui_gateway.entry``) is checked with a one-time launch
secret the app hands it. Every other way in (the ``filey`` CLI, the messaging gateway,
the ACP adapter, ``run_agent.py``, ``cli.py``) checks that the Filey app is one of its
parent processes: work the engine starts for itself (background jobs, cron delivery,
plugin hosts) descends from the app and passes; a terminal, a double-click or a script
does not. Test runs are exempt so the engine's own test suite keeps working.

This keeps ordinary use inside the app. It is not a security boundary: the source is on
disk under the AGPL, and anyone can run modified code.
"""

from __future__ import annotations

import os
import subprocess
import sys

_APP_NAMES = {"filey-erp.exe", "filey erp.exe", "filey-erp", "filey erp"}


def _process_table() -> dict[int, tuple[int, str]]:
    """pid -> (parent pid, executable name) for every running process."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class PROCESSENTRY32W(ctypes.Structure):
            _fields_ = [
                ("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
        kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        snapshot = kernel32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
        if not snapshot or snapshot == ctypes.c_void_p(-1).value:
            return {}
        table: dict[int, tuple[int, str]] = {}
        try:
            entry = PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
            more = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
            while more:
                table[int(entry.th32ProcessID)] = (int(entry.th32ParentProcessID), entry.szExeFile)
                more = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        finally:
            kernel32.CloseHandle(snapshot)
        return table
    out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,comm="], capture_output=True, text=True, timeout=5).stdout
    table = {}
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            table[int(parts[0])] = (int(parts[1]), os.path.basename(parts[2].strip()))
    return table


def started_by_filey_app() -> bool:
    """True when the Filey desktop app is an ancestor of this process."""
    try:
        table = _process_table()
    except Exception:
        return False
    pid, seen = os.getpid(), set()
    for _ in range(64):
        if pid in seen or pid not in table:
            return False
        seen.add(pid)
        parent, _name = table[pid]
        if parent in table and table[parent][1].lower() in _APP_NAMES:
            return True
        pid = parent
    return False


def require_filey_app(what: str = "Filey Agent") -> None:
    """Exit with a plain message unless the Filey app started this process (directly or not)."""
    if "pytest" in sys.modules or started_by_filey_app():
        return
    sys.stderr.write(f"{what} starts only from the Filey app.\n")
    sys.stderr.flush()
    raise SystemExit(64)
