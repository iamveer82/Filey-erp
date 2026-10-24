"""Bridge for pre-hand-off ``filey update``: a stale root ``utils`` must not kill restart.

Updaters up to v2026.9.14 finish the post-pull phases in the pre-pull interpreter and
purge only package prefixes, so root ``utils`` stays cached without ``file_signature``;
the restart phase's fresh ``filey_cli.config`` import then died with
``cannot import name 'file_signature' from 'utils'``. Freshly imported filey_cli code
drops the incomplete root cache first (``filey_cli.stale_modules``).
"""

from __future__ import annotations

import importlib
import sys

import pytest

# Mirrors the post-pull purge of a pre-hand-off updater (v2026.9.14
# filey_cli/update_cmd_maint.py): package prefixes only, root-level modules survive.
_PRE_HANDOFF_PURGE_PREFIXES = ("filey_cli", "gateway", "tools", "tui_gateway", "agent")
_PRE_HANDOFF_PURGE_PROTECTED = {"filey_cli", "filey_cli.main", "filey_cli.filey_logging"}


@pytest.fixture
def pre_handoff_purge():
    """Evict what a pre-hand-off updater evicts after the pull; restore the original graph after."""
    saved: dict = {"utils": sys.modules.get("utils")}

    def _purge() -> None:
        for name in list(sys.modules):
            if name in _PRE_HANDOFF_PURGE_PROTECTED or name.startswith("filey_cli.update_"):
                continue
            if name.split(".", 1)[0] in _PRE_HANDOFF_PURGE_PREFIXES:
                module = sys.modules.pop(name, None)
                if module is not None:
                    saved[name] = module

    yield _purge
    for name, module in saved.items():
        if module is not None:
            sys.modules[name] = module


@pytest.mark.parametrize("consumer", ["filey_cli.config", "filey_cli.managed_scope"])
def test_fresh_filey_cli_import_heals_stale_utils_missing_file_signature(
    monkeypatch, pre_handoff_purge, consumer
):
    """Restart-phase shape: filey_cli.* purged, root utils stale, consumer freshly imported."""
    import utils

    monkeypatch.delattr(utils, "file_signature")
    pre_handoff_purge()
    assert consumer not in sys.modules

    module = importlib.import_module(consumer)
    assert callable(module.file_signature)
    assert hasattr(sys.modules["utils"], "file_signature")


def test_drop_stale_root_modules_leaves_complete_utils_alone():
    import utils
    from filey_cli.stale_modules import drop_stale_root_modules

    assert hasattr(utils, "file_signature")
    before = sys.modules["utils"]
    assert drop_stale_root_modules() == []
    assert sys.modules["utils"] is before
