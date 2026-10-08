"""Fixed stdio MCP bridge; credentials and tool execution stay in the job service."""
from __future__ import annotations

import json
import ipaddress
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

MAX_BYTES = 2 * 1024 * 1024
METHODS = frozenset({"initialize", "ping", "notifications/initialized", "tools/list", "tools/call"})
JOB_PATH = r"/internal/jobs/[0-9a-fA-F-]{36}"


def endpoint(value: str, suffix: str) -> str:
    parsed = urlsplit(value)
    try:
        host = ipaddress.IPv4Address(parsed.hostname or "")
    except ipaddress.AddressValueError:
        raise ValueError("Invalid private job endpoint") from None
    permitted = host == ipaddress.IPv4Address("127.0.0.1") or any(
        host in ipaddress.IPv4Network(network) for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
    )
    if (
        parsed.scheme != "http" or not permitted or not parsed.port
        or parsed.username or parsed.password or parsed.query or parsed.fragment
        or not re.fullmatch(JOB_PATH + re.escape(suffix), parsed.path)
    ):
        raise ValueError("Invalid loopback job endpoint")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def forward(message: dict, url: str, token: str) -> dict | None:
    request_id = message.get("id")
    if message.get("jsonrpc") != "2.0" or message.get("method") not in METHODS:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method unavailable"}} if "id" in message else None
    request = urllib.request.Request(
        url, json.dumps(message).encode("utf-8"),
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST",
    )
    # No environment proxies or redirects: the opaque token is loopback-job scoped.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=35) as response:
            payload = response.read(MAX_BYTES + 1)
        if "id" not in message:
            return None
        if len(payload) > MAX_BYTES:
            raise ValueError("MCP response too large")
        result = json.loads(payload)
        if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or result.get("id") != request_id:
            raise ValueError("Invalid MCP response")
        return result
    except (OSError, ValueError, urllib.error.URLError):
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": "Filey tool unavailable"}} if "id" in message else None


def main() -> None:
    url = endpoint(os.environ.get("FILEY_HERMES_MCP_URL", ""), "/mcp")
    token = os.environ.get("FILEY_HERMES_PROXY_TOKEN", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
        raise ValueError("Invalid job token")
    while line := sys.stdin.buffer.readline(MAX_BYTES + 1):
        if len(line) > MAX_BYTES:
            raise ValueError("MCP input too large")
        message = json.loads(line)
        if not isinstance(message, dict):
            raise ValueError("Invalid MCP input")
        result = forward(message, url, token)
        if result is not None:
            print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Filey MCP bridge stopped", file=sys.stderr)
        raise SystemExit(1)
