"""The local transport can use Git Bash without a PATH entry."""
import os
from pathlib import Path
import subprocess

import pytest

from pm.shell import windows_bash_candidates


def test_windows_bash_candidates_include_a_user_hermes_git():
    env = {"LOCALAPPDATA": r"C:\Users\me\AppData\Local", "ProgramFiles": r"C:\Program Files"}
    found = windows_bash_candidates(None, env)
    assert r"C:\Users\me\AppData\Local\hermes\git\bin\bash.exe" in found
    assert r"C:\Users\me\AppData\Local\hermes\git\usr\bin\bash.exe" in found


@pytest.mark.platforms("windows")
def test_local_transport_finds_conventional_bash_without_path(monkeypatch, tmp_path):
    from tools.environments.local import _find_bash

    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    conventional = program_files / "Git/bin/bash.exe"
    if not conventional.is_file():
        pytest.skip("a conventional Git for Windows installation is required")

    monkeypatch.setenv("ProgramFiles", str(program_files))
    monkeypatch.setenv("FILEY_RUNTIME_DIR", str(tmp_path / "tools"))
    empty_bin = tmp_path / "empty-bin"
    alias_bin = tmp_path / "WindowsApps"
    empty_bin.mkdir()
    alias_bin.mkdir()
    (alias_bin / "bash.exe").write_bytes(b"unusable execution alias")
    monkeypatch.setenv("PATHEXT", ".EXE;.CMD")

    for directory in (empty_bin, alias_bin):
        monkeypatch.setenv("PATH", str(directory))
        selected = _find_bash()
        assert Path(selected) == conventional
        child = subprocess.run(
            [selected, "--noprofile", "--norc", "-c", "printf shell-ready"],
            cwd=tmp_path, capture_output=True, text=True, timeout=10,
            check=False,
        )
        assert child.returncode == 0, child.stderr
        assert child.stdout == "shell-ready"
