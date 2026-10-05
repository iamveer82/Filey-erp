from __future__ import annotations

import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from bootstrap import archive_members, verify_source


class BootstrapTests(unittest.TestCase):
    def fixture(self, directory):
        revision = "a" * 40
        source = Path(directory) / f"hermes-agent-{revision}"
        source.mkdir()
        archive = Path(directory) / "source.zip"
        files = {"run_agent.py": b"# pinned upstream fixture\n", "LICENSE": b"MIT fixture\n"}
        with zipfile.ZipFile(archive, "w") as output:
            for name, data in files.items():
                output.writestr(f"{source.name}/{name}", data)
                (source / name).write_bytes(data)
        lock = {"revision": revision, "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
        return source, lock

    def test_verified_archive_and_identical_source_pass(self):
        with tempfile.TemporaryDirectory() as scratch:
            source, lock = self.fixture(scratch)
            with patch("bootstrap.load_lock", return_value=lock):
                verify_source(source)

    def test_modified_source_and_added_dotenv_fail_closed(self):
        for tamper in ("changed", "extra", "bytecode"):
            with self.subTest(tamper=tamper), tempfile.TemporaryDirectory() as scratch:
                source, lock = self.fixture(scratch)
                if tamper == "changed":
                    (source / "run_agent.py").write_text("print('modified')")
                elif tamper == "extra":
                    (source / ".env").write_text("UNEXPECTED_PROVIDER_KEY=value")
                else:
                    (source / "__pycache__").mkdir()
                    (source / "__pycache__" / "run_agent.pyc").write_bytes(b"unverified bytecode")
                with patch("bootstrap.load_lock", return_value=lock), self.assertRaises(ValueError):
                    verify_source(source)

    def test_wrong_archive_checksum_fails_before_import(self):
        with tempfile.TemporaryDirectory() as scratch:
            source, lock = self.fixture(scratch)
            lock["archive_sha256"] = "0" * 64
            with patch("bootstrap.load_lock", return_value=lock), self.assertRaises(ValueError):
                verify_source(source)

    def test_archive_path_traversal_rejected(self):
        revision = "a" * 40
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr(f"hermes-agent-{revision}/../escape.py", "bad")
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive, self.assertRaises(ValueError):
            archive_members(archive, revision)


if __name__ == "__main__":
    unittest.main()
