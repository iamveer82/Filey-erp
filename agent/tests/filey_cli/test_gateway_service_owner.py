"""Gateway service-definition writes belong to the home the definition pins.

Every gateway boot refreshes "its" unit, and a scratch/E2E process whose service name resolves to the
real install's unit (a fake FILEY_HOME under ~/.filey-agent/cache/scratch takes the bare name, and
``<root>/profiles/x`` collides with ``~/.filey-agent/profiles/x``) rewrote that unit to point at the scratch
home. The real gateway then crash-looped on its next restart.
"""

from types import SimpleNamespace

import pytest

import filey_cli.gateway as gw
from filey_cli import gateway_service_owner

UNIT = (
    "[Service]\n"
    "ExecStart=/home/ace/.filey-agent/filey-agent/.filey-agent/bin/filey gateway run\n"
    "WorkingDirectory={home}\n"
    'Environment="FILEY_HOME={home}"\n'
)


@pytest.fixture
def unit(tmp_path, monkeypatch):
    real = tmp_path / "account" / ".filey-agent"
    scratch = tmp_path / "scratch" / "fakehome" / ".filey-agent"
    real.mkdir(parents=True)
    scratch.mkdir(parents=True)
    path = tmp_path / "systemd" / "filey-gateway.service"
    path.parent.mkdir()
    path.write_text(UNIT.format(home=real), encoding="utf-8")
    calls = []
    # The temp-root guard only sees homes under a temp dir; scratch homes elsewhere are what slipped past.
    monkeypatch.setattr(gateway_service_owner, "refuse_temp_home_service_write", lambda definition, kind: False)
    monkeypatch.setattr(gw, "get_systemd_unit_path", lambda system=False: path)
    monkeypatch.setattr(gw, "systemd_unit_is_current", lambda system=False: False)
    monkeypatch.setattr(gw, "_retire_filey_replace_dropin", lambda system=False: False)
    monkeypatch.setattr(gw, "_prepare_service_launcher", lambda system=False, run_as_user=None: None)
    monkeypatch.setattr(gw, "generate_systemd_unit", lambda system=False, run_as_user=None: "ExecStart=new\n")
    monkeypatch.setattr(gw, "_run_systemctl", lambda args, **kw: calls.append(tuple(args)) or
                        SimpleNamespace(returncode=0, stdout="", stderr=""))
    return SimpleNamespace(path=path, real=real, scratch=scratch, calls=calls,
                           original=path.read_text(encoding="utf-8"))


def test_refresh_from_another_home_leaves_the_unit_untouched(unit, monkeypatch, capsys):
    monkeypatch.setenv("FILEY_HOME", str(unit.scratch))
    assert gw.refresh_systemd_unit_if_needed(system=False) is False
    assert unit.path.read_text(encoding="utf-8") == unit.original
    assert ("daemon-reload",) not in unit.calls
    assert "Refusing to rewrite" in capsys.readouterr().out


def test_refresh_from_the_pinned_home_still_rewrites_a_stale_unit(unit, monkeypatch):
    monkeypatch.setenv("FILEY_HOME", str(unit.real))
    assert gw.refresh_systemd_unit_if_needed(system=False) is True
    assert unit.path.read_text(encoding="utf-8") == "ExecStart=new\n"
    assert ("daemon-reload",) in unit.calls


class TestTempHomeServiceDefinitionGuard:
    """temp_home_in_service_definition() — structural temp-dir detection."""

    def test_detects_tmp_home_in_systemd_unit(self):
        unit = '[Service]\nEnvironment="FILEY_HOME=/tmp/filey-e2e-41264"\n'
        assert (
            gateway_service_owner.temp_home_in_service_definition(unit)
            == "/tmp/filey-e2e-41264"
        )

    def test_detects_tempdir_env_home(self, monkeypatch, tmp_path):
        import tempfile as _tempfile

        monkeypatch.setattr(_tempfile, "gettempdir", lambda: str(tmp_path))
        unit = f'[Service]\nEnvironment="FILEY_HOME={tmp_path}/filey-home"\n'
        assert gateway_service_owner.temp_home_in_service_definition(unit) is not None
