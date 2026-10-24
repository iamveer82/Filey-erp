"""Resolve FILEY_HOME for standalone skill scripts.

Skill scripts may run outside the Filey process (system Python, nix env,
CI) where ``filey_constants`` is not importable.  This module provides the
same ``get_filey_home()`` contract without requiring it on ``sys.path``.

When ``filey_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from filey_constants import get_filey_home
except (ModuleNotFoundError, ImportError):

    def get_filey_home() -> Path:
        """Return the Filey home directory (default: ``~/.filey-agent``)."""
        val = os.environ.get("FILEY_HOME", "").strip()
        return Path(val) if val else Path.home() / ".filey-agent"
