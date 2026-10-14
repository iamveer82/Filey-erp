"""Filey Agent host: serves the Filey Agent to Filey web and phone users from this machine.

    phone --wss--> Cloudflare Tunnel (agent.gofiley.com) --> 127.0.0.1:8787/ws --> one agent process per user

Each signed-in user gets their own agent process (`tui_gateway.entry`, the desktop sidecar's wire:
newline JSON-RPC) with its own home folder, so memories, skills and sessions never mix. Business
actions are not run here: the agent sends `filey.tool` requests back to the user's app, which runs
them with its own runTool against the user's own account. Locks a shared public endpoint needs:
  1. The first frame must be {"method": "filey.auth", "params": {"access_token": ...}}: a Filey session
     the Supabase auth server accepts, for an account allowed by access.txt ("*" = any verified account).
  2. Only the chat RPCs reach an agent; every other gateway RPC (config, shell, skills…) is refused.
  3. Agents are pinned to the "filey-app-session" toolset (Filey tools, web, memory, reminders: no
     terminal, files or browser), private/home-network URLs stay blocked, and agent processes get a
     scrubbed environment, so this machine's keys and folders are not theirs.
  4. One live connection per user (a second tab would answer the same tool request twice), at most
     MAX_AGENTS running agents, and agents with no connection stop after IDLE_MINUTES.

Run from the repo root:  agent\\.venv\\Scripts\\python.exe tools\\agent-host\\host.py
Access list: <home>/access.txt, one Filey account email or user id per line, or "*" (home is printed at start).
"""
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket

ROOT = Path(__file__).resolve().parents[2]
AGENT_DIR = ROOT / "agent"
PYTHON = Path(sys.executable)
HOME = Path(os.environ.get("FILEY_AGENT_HOST_HOME")
            or Path(os.environ.get("APPDATA", Path.home())) / "com.iamvi.filey-erp" / "filey-agent-host")
PORT = int(os.environ.get("FILEY_AGENT_HOST_PORT", "8787"))
MAX_AGENTS = int(os.environ.get("FILEY_AGENT_MAX_AGENTS", "4"))
IDLE_MINUTES = float(os.environ.get("FILEY_AGENT_IDLE_MINUTES", "15"))
SUPABASE_URL = "https://voyrjqgaypiylwskkwpr.supabase.co"
# Publishable (public) key, the same one the web app ships (src/lib/supabaseConfig.ts).
ANON_KEY = "sb_publishable_seG6PypmkIEN9FYKY9Of6w_UGNTGAgv"
ORIGINS = {o.strip() for o in os.environ.get(
    "FILEY_AGENT_ORIGINS",
    "https://app.gofiley.com,capacitor://localhost,https://localhost,http://localhost:5173",
).split(",") if o.strip()}
CHAT_RPCS = {"client.capabilities", "session.create", "prompt.submit", "session.interrupt"}
UID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# What an agent process may inherit: enough for Python and cmd.exe to run, nothing that names a secret.
PASS_ENV = ("SYSTEMROOT", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "NUMBER_OF_PROCESSORS",
            "PROCESSOR_ARCHITECTURE", "OS", "LANG", "TZ")


def allowed() -> set[str]:
    listed = os.environ.get("FILEY_AGENT_ACCESS", "").split(",")
    for name in ("access.txt", "owners.txt"):  # owners.txt: the first, single-owner layout
        path = HOME / name
        if path.exists():
            listed += path.read_text(encoding="utf-8").splitlines()
    return {o.strip().lower() for o in listed if o.strip() and not o.strip().startswith("#")}


async def verify(token: str) -> dict | None:
    """The account behind *token*, if Supabase accepts it and the access list lets it in."""
    if not token or len(token) > 4096 or any(c.isspace() or c == '"' for c in token):
        return None
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{SUPABASE_URL}/auth/v1/user",
                                 headers={"apikey": ANON_KEY, "Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    user = r.json()
    if not UID.match(str(user.get("id", ""))) or not user.get("email_confirmed_at"):
        return None
    access = allowed()
    return user if "*" in access or {user["id"], str(user.get("email") or "").lower()} & access else None


def seed_config(home: Path) -> None:
    """Same model route as the desktop sidecar (src-tauri/src/modules/filey_agent.rs::seed_config)."""
    path = home / "config.yaml"
    if path.exists():
        return
    key_cmd = r'type "%FILEY_HOME%\filey-session.json"' if os.name == "nt" else 'cat "$FILEY_HOME/filey-session.json"'
    path.write_text(
        "model:\n  provider: filey\n  default: filey-ai\n"
        f"providers:\n  filey:\n    name: Filey AI\n    base_url: {SUPABASE_URL}/functions/v1/ai-credits\n"
        f"    key_cmd: '{key_cmd}'\n    default_model: filey-ai\n    context_length: 131072\n    discover_models: false\n"
        "compression:\n  threshold_tokens: 12000\n"
        "security:\n  allow_private_urls: false\n",
        encoding="utf-8",
    )


def write_session(home: Path, token: str, expires_at: object) -> None:
    """The model bills the user's own Coins: key_cmd reads this file on every model request."""
    exp = int(expires_at) if isinstance(expires_at, (int, float)) else int(time.time()) + 3600
    (home / "filey-session.json").write_text(
        json.dumps({"access_token": token, "expires_in": max(exp - int(time.time()), 0)}), encoding="utf-8")


def guard(raw: str) -> tuple[str | None, str | None]:
    """(line for the agent, reply for the app). Answers to the agent's own requests pass through."""
    try:
        frame = json.loads(raw)
    except ValueError:
        return None, json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
    if not isinstance(frame, dict) or "method" not in frame:
        return raw, None
    method = frame.get("method")
    if method == "gateway.ping":  # the app's keep-alive through Cloudflare; the agent needn't wake
        return None, json.dumps({"jsonrpc": "2.0", "id": frame.get("id"), "result": {"ok": True}})
    if method == "session.create":
        key = (frame.get("params") or {}).get("idempotency_key")
        frame["params"] = {"source": "filey", **({"idempotency_key": str(key)[:200]} if key else {})}
        return json.dumps(frame), None
    if method in CHAT_RPCS:
        return raw, None
    return None, json.dumps({"jsonrpc": "2.0", "id": frame.get("id"),
                             "error": {"code": -32601, "message": f"{method} is not available here"}})


class UserAgent:
    """One user's agent process and their one live connection."""

    def __init__(self, uid: str):
        self.uid = uid
        self.home = HOME / "users" / uid
        self.proc: asyncio.subprocess.Process | None = None
        self.ws: WebSocket | None = None
        self.ready_line: str | None = None
        self.idle_since = time.monotonic()
        self.send_lock = asyncio.Lock()

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self) -> None:
        for sub in ("workspace", "tmp", "appdata", "localappdata"):
            (self.home / sub).mkdir(parents=True, exist_ok=True)
        seed_config(self.home)
        env = {k: os.environ[k] for k in PASS_ENV if k in os.environ}
        env.update({
            "FILEY_HOME": str(self.home), "FILEY_TUI_TOOLSETS": "filey-app-session",
            "PYTHONPATH": str(AGENT_DIR), "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
            "HOME": str(self.home), "USERPROFILE": str(self.home),
            "TEMP": str(self.home / "tmp"), "TMP": str(self.home / "tmp"),
            "APPDATA": str(self.home / "appdata"), "LOCALAPPDATA": str(self.home / "localappdata"),
        })
        log = open(self.home / "agent.log", "ab")
        self.proc = await asyncio.create_subprocess_exec(
            str(PYTHON), "-m", "tui_gateway.entry", cwd=self.home / "workspace", env=env,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=log,
            limit=64 * 1024 * 1024, creationflags=0x08000000 if os.name == "nt" else 0)  # no console window
        self.ready_line = None
        asyncio.create_task(self._pump(self.proc))

    async def _pump(self, proc: asyncio.subprocess.Process) -> None:
        """Agent stdout to the user's live connection; lines with no connection wait for none."""
        assert proc.stdout is not None
        while line := await proc.stdout.readline():
            text = line.decode("utf-8", "replace").strip()
            if not text.startswith("{"):
                continue
            if self.ready_line is None and '"gateway.ready"' in text:
                self.ready_line = text
            await self.send(text)
        if self.ws is not None and proc is self.proc:
            await self.close_ws(1011, "The Filey Agent stopped. Send your message again to restart it.")

    async def send(self, text: str) -> None:
        ws = self.ws
        if ws is None:
            return
        async with self.send_lock:
            try:
                await ws.send_text(text)
            except Exception:
                pass  # the read loop sees the disconnect

    async def write(self, line: str) -> None:
        if not self.running:
            await self.start()
        assert self.proc is not None and self.proc.stdin is not None
        self.proc.stdin.write((line + "\n").encode("utf-8"))
        await self.proc.stdin.drain()

    async def close_ws(self, code: int, reason: str) -> None:
        ws, self.ws = self.ws, None
        self.idle_since = time.monotonic()
        if ws is not None:
            try:
                await ws.close(code=code, reason=reason)
            except Exception:
                pass

    async def stop(self) -> None:
        """End of input lets the gateway exit cleanly; then the whole tree goes, because a venv's
        python.exe is a launcher whose child interpreter holds the pipes and outlives a plain kill."""
        proc = self.proc
        if proc is None or proc.returncode is not None:
            return
        try:
            proc.stdin.close()
            await asyncio.wait_for(proc.wait(), 5)
        except Exception:
            if os.name == "nt":
                await (await asyncio.create_subprocess_exec(
                    "taskkill", "/PID", str(proc.pid), "/T", "/F",
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)).wait()
            else:
                proc.kill()


agents: dict[str, UserAgent] = {}


async def agent_for(uid: str) -> UserAgent | None:
    """This user's agent, started if needed; None when the machine is full of connected users."""
    agent = agents.get(uid) or agents.setdefault(uid, UserAgent(uid))
    if not agent.running:
        busy = [a for a in agents.values() if a.running]
        if len(busy) >= MAX_AGENTS:
            idle = sorted((a for a in busy if a.ws is None), key=lambda a: a.idle_since)
            if not idle:
                return None
            await idle[0].stop()
        await agent.start()
    return agent


async def reap_idle() -> None:
    while True:
        await asyncio.sleep(60)
        cutoff = time.monotonic() - IDLE_MINUTES * 60
        for agent in agents.values():
            if agent.running and agent.ws is None and agent.idle_since < cutoff:
                await agent.stop()


def build_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.on_event("startup")
    async def start_reaper() -> None:
        asyncio.create_task(reap_idle())

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "agents": sum(a.running for a in agents.values()), "max": MAX_AGENTS}

    @app.websocket("/ws")
    async def agent_socket(ws: WebSocket) -> None:
        if ws.headers.get("origin", "") not in ORIGINS:
            await ws.close(code=4403)
            return
        await ws.accept()
        try:
            first = json.loads(await asyncio.wait_for(ws.receive_text(), 15))
            params = first.get("params") or {}
            assert first.get("method") == "filey.auth"
            user = await verify(str(params.get("access_token", "")))
        except Exception:
            user = None
        if not user:
            await ws.close(code=4401, reason="Sign in with a Filey account that may use this agent")
            return
        agent = await agent_for(user["id"])
        if agent is None:
            await ws.close(code=4429, reason="The Filey Agent is busy. Try again in a few minutes.")
            return
        write_session(agent.home, params["access_token"], params.get("expires_at"))
        # One live connection per user: the newest replaces the old one.
        await agent.close_ws(4409, "Filey Agent opened in another window")
        agent.ws = ws
        if agent.ready_line:
            await agent.send(agent.ready_line)  # an agent already running announced itself earlier
        try:
            while True:
                raw = await ws.receive_text()
                frame = json.loads(raw) if raw.lstrip().startswith("{") else None
                if isinstance(frame, dict) and frame.get("method") == "filey.session":
                    p = frame.get("params") or {}
                    fresh = await verify(str(p.get("access_token", "")))
                    if fresh and fresh["id"] == agent.uid:
                        write_session(agent.home, p["access_token"], p.get("expires_at"))
                    continue
                line, reply = guard(raw)
                if reply:
                    await agent.send(reply)
                if line:
                    await agent.write(line)
        except Exception:
            pass  # disconnect
        finally:
            if agent.ws is ws:
                agent.ws = None
                agent.idle_since = time.monotonic()

    return app


if __name__ == "__main__":
    import uvicorn

    HOME.mkdir(parents=True, exist_ok=True)
    access = allowed()
    print(f"Filey Agent host  home={HOME}  http://127.0.0.1:{PORT}  access={'everyone' if '*' in access else len(access)}"
          f"  max agents={MAX_AGENTS}", flush=True)
    if not access:
        print(f"Nobody can sign in yet: add account emails, or *, to {HOME / 'access.txt'}", flush=True)
    # Loopback only: the tunnel is the one way in.
    uvicorn.run(build_app(), host="127.0.0.1", port=PORT, log_level="info", ws_ping_interval=20)
