"""Plugin data paths follow the active profile's FILEY_HOME, including the ContextVar override.

Several plugins carried a ``~/.filey-agent`` fallback (guarding an ImportError of ``filey_constants``
that cannot happen for a bundled plugin) or resolved the home at import time. Both are wrong on
Windows and under multiplex profile overrides. Every resolver below must land inside the override.
"""
from __future__ import annotations

import pytest

from filey_constants import reset_filey_home_override, set_filey_home_override


def _a2a_conversation(home):
    from plugins.platforms.a2a import protocol
    return protocol._conv_path("peer-x")


def _photon_auth(home):
    from plugins.platforms.photon import auth
    return auth._auth_json_path()


_RESOLVERS = {"a2a": _a2a_conversation, "photon": _photon_auth}


@pytest.mark.parametrize("name", sorted(_RESOLVERS))
def test_plugin_path_follows_profile_override(name, tmp_path, monkeypatch):
    monkeypatch.setenv("FILEY_HOME", str(tmp_path / "default"))
    monkeypatch.setenv("HOME", str(tmp_path / "user-home"))
    profile = tmp_path / "profiles" / "b"
    profile.mkdir(parents=True)
    token = set_filey_home_override(profile)
    try:
        resolved = str(_RESOLVERS[name](profile))
    finally:
        reset_filey_home_override(token)
    assert resolved.startswith(str(profile)), f"{name} resolved {resolved!r} outside the active profile"
