"""Prepare the pinned source and hash-locked MCP-only venv outside the checkout."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tempfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent


def load_lock() -> dict:
    return json.loads((HERE / "upstream.lock.json").read_text(encoding="utf-8"))


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def archive_members(archive: zipfile.ZipFile, revision: str):
    prefix = f"hermes-agent-{revision}/"
    entries = []
    total = 0
    seen = set()
    for item in archive.infolist():
        if not item.filename.startswith(prefix):
            raise ValueError("Unexpected archive root")
        raw = item.filename[len(prefix):]
        if not raw or item.is_dir():
            continue
        path = PurePosixPath(raw)
        if path.is_absolute() or ".." in path.parts or "\\" in raw or ":" in raw:
            raise ValueError("Unsafe archive path")
        if stat.S_ISLNK(item.external_attr >> 16) or raw in seen:
            raise ValueError("Unsafe archive member")
        total += item.file_size
        if total > 512 * 1024 * 1024 or len(entries) > 30_000:
            raise ValueError("Archive exceeds the pinned runtime bounds")
        seen.add(raw)
        entries.append((item, raw))
    if "run_agent.py" not in seen or "LICENSE" not in seen:
        raise ValueError("Incomplete Hermes archive")
    return entries


def verify_source(source: Path) -> None:
    """Verify source bytes against the locked archive, including added files."""
    lock = load_lock()
    source = source.resolve(strict=True)
    archive_path = source.parent / "source.zip"
    if source.name != f"hermes-agent-{lock['revision']}" or file_hash(archive_path) != lock["archive_sha256"]:
        raise ValueError("Hermes source is not the pinned revision")
    with zipfile.ZipFile(archive_path) as archive:
        expected = set()
        for item, raw in archive_members(archive, lock["revision"]):
            expected.add(raw)
            target = source / raw
            if target.is_symlink() or not target.is_file():
                raise ValueError("Hermes source integrity failed")
            with archive.open(item) as original, target.open("rb") as extracted:
                if hashlib.file_digest(original, "sha256").digest() != hashlib.file_digest(extracted, "sha256").digest():
                    raise ValueError("Hermes source integrity failed")
        actual = {
            path.relative_to(source).as_posix()
            for path in source.rglob("*")
            if path.is_file()
        }
        if any(path.is_symlink() for path in source.rglob("*")):
            raise ValueError("Unexpected source symlink")
        if actual != expected:
            raise ValueError("Unpinned files in Hermes source")


def prepare_source(cache: Path) -> Path:
    lock = load_lock()
    directory = cache / lock["revision"]
    directory.mkdir(parents=True, exist_ok=True)
    archive_path = directory / "source.zip"
    if not archive_path.exists():
        with urllib.request.urlopen(lock["archive_url"], timeout=60) as response, tempfile.NamedTemporaryFile(dir=directory, delete=False) as output:
            temporary = Path(output.name)
            try:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 128 * 1024 * 1024:
                        raise ValueError("Source archive is too large")
                    output.write(chunk)
            except BaseException:
                output.close()
                temporary.unlink(missing_ok=True)
                raise
        if file_hash(temporary) != lock["archive_sha256"]:
            temporary.unlink()
            raise ValueError("Source archive checksum mismatch")
        temporary.replace(archive_path)
    if file_hash(archive_path) != lock["archive_sha256"]:
        raise ValueError("Source archive checksum mismatch")
    source = directory / f"hermes-agent-{lock['revision']}"
    if not source.exists():
        with tempfile.TemporaryDirectory(dir=directory) as scratch:
            stage = Path(scratch) / source.name
            stage.mkdir()
            with zipfile.ZipFile(archive_path) as archive:
                for item, raw in archive_members(archive, lock["revision"]):
                    target = stage / raw
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(item) as original, target.open("wb") as output:
                        shutil.copyfileobj(original, output)
            stage.rename(source)
    # Cached bytecode may predate integrity verification. Never import it.
    for compiled in source.rglob("__pycache__"):
        resolved = compiled.resolve()
        if compiled.is_symlink() or not resolved.is_relative_to(source.resolve()):
            raise ValueError("Unsafe bytecode cache")
        shutil.rmtree(resolved)
    verify_source(source)
    return source


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--uv", default="uv", help="Operator-approved uv executable")
    parser.add_argument("--source-only", action="store_true")
    args = parser.parse_args()
    cache = args.cache.resolve()
    if cache.is_relative_to(HERE.parents[1]):
        raise ValueError("Runtime cache must be outside the Git checkout")
    source = prepare_source(cache)
    result = {"source": str(source)}
    if not args.source_only:
        lock = load_lock()
        env = {**os.environ, "UV_PYTHON_INSTALL_DIR": str(cache / "python"), "UV_CACHE_DIR": str(cache / "uv-cache")}
        subprocess.run([args.uv, "python", "install", lock["python"], "--no-bin", "--no-registry"], check=True, env=env)
        python = subprocess.check_output([args.uv, "python", "find", "--managed-python", lock["python"]], env=env, text=True).strip()
        venv = cache / "venv"
        subprocess.run([args.uv, "venv", "--allow-existing", "--python", python, str(venv)], check=True, env=env)
        interpreter = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        subprocess.run([args.uv, "pip", "sync", "--python", str(interpreter), "--require-hashes", str(HERE / "requirements.lock")], check=True, env=env)
        result["python"] = str(interpreter)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
