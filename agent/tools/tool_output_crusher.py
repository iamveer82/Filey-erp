"""Shrink long JSON lists in Filey tool results before the model reads them.

The selection rules are ported from headroom's SmartCrusher (headroomlabs-ai/headroom,
crates/headroom-core/src/transforms/smart_crusher; Apache-2.0, Copyright Headroom Contributors).
A long list keeps its head and tail, every row that looks like an error, and rows with a rare
field or a rare status value; the rest is left out with a count. headroom caches the dropped rows
for retrieval; Filey's list tools page with a query or limit/offset instead, so the note says so.

Filey AI on Coins leaves a conversation about 16K tokens next to the base prompt: one 54-row tool
catalogue (12K characters) was most of a WhatsApp chat's room.
"""

from __future__ import annotations

import json
import math
from typing import Any

ERROR_KEYWORDS = ("error", "exception", "failed", "failure", "critical", "fatal",
                  "crash", "panic", "abort", "timeout", "denied", "rejected")
MIN_RESULT_CHARS = 6000   # smaller results pass untouched (headroom: min_tokens_to_crush)
MIN_ITEMS = 16            # shorter lists are never cut
KEEP = 15                 # headroom: max_items_after_crush
FIRST, LAST = 0.3, 0.15   # headroom: first_fraction / last_fraction


def _text(item: Any) -> str:
    return item.lower() if isinstance(item, str) else json.dumps(item, ensure_ascii=False).lower()


def _signal_rows(items: list) -> set[int]:
    """Rows worth keeping wherever they sit: errors, rare fields, rare status values."""
    marked = {i for i, item in enumerate(items) if any(k in _text(item) for k in ERROR_KEYWORDS)}
    dicts = [(i, item) for i, item in enumerate(items) if isinstance(item, dict)]
    n = len(dicts)
    if n >= 5:
        counts: dict[str, int] = {}
        for _, item in dicts:
            for key in item:
                counts[key] = counts.get(key, 0) + 1
        rare = {k for k, c in counts.items() if c < n * 0.2}
        marked |= {i for i, item in dicts if rare.intersection(item)}
        for field in sorted(k for k, c in counts.items() if c >= n * 0.8):
            values = [(i, item.get(field)) for i, item in dicts if field in item]
            seen = [json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v for _, v in values]
            distinct: dict[str, int] = {}
            for s in seen:
                distinct[s] = distinct.get(s, 0) + 1
            if not 2 <= len(distinct) <= 50:
                continue
            # Pareto: the few values that cover 80% are "normal"; the rest are worth seeing.
            top, covered = set(), 0
            for value, count in sorted(distinct.items(), key=lambda kv: (-kv[1], kv[0])):
                top.add(value)
                covered += count
                if covered >= math.ceil(len(values) * 0.8):
                    break
            if len(top) <= 5:
                marked |= {i for (i, _), s in zip(values, seen) if s not in top}
    # A signal on most rows is a field name, not a signal (an "error_count" on every row).
    return marked if len(marked) <= len(items) // 2 else set()


def crush_list(items: list) -> tuple[list, int]:
    """(kept rows in their original order, how many were left out)."""
    if len(items) < MIN_ITEMS:
        return items, 0
    head, tail = math.ceil(KEEP * FIRST), math.ceil(KEEP * LAST)
    keep = set(range(head)) | set(range(len(items) - tail, len(items)))
    keep |= set(sorted(_signal_rows(items))[: KEEP * 2])
    nxt = head
    while len(keep) < KEEP and nxt < len(items):
        keep.add(nxt)
        nxt += 1
    kept = [items[i] for i in sorted(keep)]
    return kept, len(items) - len(kept)


def _note(left_out: int, total: int) -> str:
    return (f"{left_out} of {total} left out to save space (kept the first and last, errors and "
            "unusual ones). Ask again with a narrower query, or a limit/offset, to see the rest.")


def _walk(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, child in value.items():
            if isinstance(child, list):
                kept, left_out = crush_list([_walk(x) for x in child])
                out[key] = kept
                if left_out:
                    out[f"{key}_left_out"] = _note(left_out, len(child))
            else:
                out[key] = _walk(child)
        return out
    if isinstance(value, list):
        return [_walk(x) for x in value]
    return value


def crush_json_text(text: str) -> str:
    """The same JSON with its long lists cut down, or ``text`` unchanged when it is small,
    not JSON, or would not get shorter."""
    if len(text) < MIN_RESULT_CHARS:
        return text
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return text
    if isinstance(data, list):
        kept, left_out = crush_list([_walk(x) for x in data])
        crushed: Any = {"items": kept, "items_left_out": _note(left_out, len(data))} if left_out else kept
    else:
        crushed = _walk(data)
    out = json.dumps(crushed, ensure_ascii=False)
    return out if len(out) < len(text) else text
