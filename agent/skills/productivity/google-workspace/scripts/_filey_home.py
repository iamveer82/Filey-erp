"""Resolve FILEY_HOME for standalone skill scripts.

Skill scripts may run outside the Filey process (e.g. system Python,
nix env, CI) where ``filey_constants`` is not importable.  This module
provides the same ``get_filey_home()`` and ``display_filey_home()``
contracts as ``filey_constants`` without requiring it on ``sys.path``.

When ``filey_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``filey_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``FILEY_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from filey_constants import display_filey_home
    from filey_constants import get_filey_home
except (ModuleNotFoundError, ImportError):

    def get_filey_home() -> Path:
        """Return the Filey home directory (default: ~/.filey-agent).

        Mirrors ``filey_constants.get_filey_home()``."""
        val = os.environ.get("FILEY_HOME", "").strip()
        return Path(val) if val else Path.home() / ".filey-agent"

    def display_filey_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``filey_constants.display_filey_home()``."""
        home = get_filey_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
