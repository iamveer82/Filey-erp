"""Config v51: Harness² joins the bundled default-on plugins."""

import filey_yaml as yaml


class TestHarness2DefaultPlugin:
    def test_v51_appends_harness2_without_dropping_existing_plugins(self, tmp_path, monkeypatch):
        from filey_cli.config_migrations import run_migrations

        config_path = tmp_path / "config.yaml"
        config_path.write_text(yaml.safe_dump({
            "_config_version": 50,
            "plugins": {"enabled": ["other-plugin"], "disabled": ["broken-plugin"]},
        }), encoding="utf-8")
        monkeypatch.setenv("FILEY_HOME", str(tmp_path))
        run_migrations(50, {"env_added": [], "config_added": [], "warnings": []}, quiet=True)
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        assert raw["plugins"]["enabled"] == ["other-plugin", "harness2"]
        assert raw["plugins"]["disabled"] == ["broken-plugin"]

    def test_v51_is_idempotent(self, tmp_path, monkeypatch):
        from filey_cli.config_migrations import run_migrations

        config_path = tmp_path / "config.yaml"
        config_path.write_text(yaml.safe_dump({
            "_config_version": 50,
            "plugins": {"enabled": ["harness2"]},
        }), encoding="utf-8")
        monkeypatch.setenv("FILEY_HOME", str(tmp_path))
        run_migrations(50, {"env_added": [], "config_added": [], "warnings": []}, quiet=True)
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        assert raw["plugins"]["enabled"] == ["harness2"]
