"""Filey app screenshots reach the model as images or not at all, never as base64 text."""

import base64
import json
from pathlib import Path
from unittest.mock import patch

from tools import filey_app_tool

SHOT = {"ok": True, "window_id": "7", "image": {"mediaType": "image/png", "dataBase64": "A" * 4000}}
NATIVE = "tools.vision_tools._should_use_native_vision_fast_path"


def run(result, args=None, seen=None):
    # The app answers with the tool's JSON text, as filey_app_bridge relays it.
    def callback(payload):
        if seen is not None:
            seen.append(payload)
        return json.dumps(result)
    return filey_app_tool.filey_run_tool(name="computer_use", args=args or {"action": "app_state", "app": "notepad"},
                                         callback=callback)


def test_model_without_inline_vision_gets_a_saved_file_instead_of_the_bytes():
    shot = {**SHOT, "image": {"mediaType": "image/png", "dataBase64": base64.b64encode(b"\x89PNG fake").decode() * 40}}
    with patch(NATIVE, return_value=False):
        out = run(shot)
    assert isinstance(out, str) and "iVBO" not in out and "UE5H" not in out
    data = json.loads(out)
    assert data["image"] == {"mediaType": "image/png", "attached": True}
    saved = Path(data["screenshot"]["path"])
    assert saved.is_file() and saved.read_bytes().startswith(b"\x89PNG fake")
    assert "vision_analyze" in data["screenshot"]["note"]
    assert data["window_id"] == "7"


def test_model_without_inline_vision_reads_the_tree_unless_it_asks_for_a_picture():
    seen: list = []
    with patch(NATIVE, return_value=False):
        run({"ok": True, "tree": "0 window Notepad"}, {"action": "app_click", "app": "notepad", "element_index": 3}, seen)
        run({"ok": True, "tree": "0 window Notepad"}, {"action": "app_state", "app": "notepad", "include_screenshot": True}, seen)
    assert seen[0]["args"]["include_screenshot"] is False
    assert seen[1]["args"]["include_screenshot"] is True


def test_vision_model_gets_a_real_image_part():
    seen: list = []
    with patch(NATIVE, return_value=True), \
            patch.object(filey_app_tool, "_embed", return_value=("data:image/jpeg;base64,xyz", "Multiply x by 2.")):
        out = run(SHOT, seen=seen)
    assert "include_screenshot" not in seen[0]["args"]
    assert out["_multimodal"] is True
    assert "AAAA" not in out["text_summary"]
    assert out["content"][1] == {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,xyz"}}
    assert "Multiply x by 2." in out["content"][0]["text"]


def test_results_without_images_pass_through_unchanged():
    plain = {"ok": True, "invoices": [{"number": "INV-1"}]}
    assert json.loads(filey_app_tool.filey_run_tool(name="list_invoices", args={}, callback=lambda _p: json.dumps(plain))) == plain
    nested = {"snapshot": {"screenshotPngBase64": "B" * 5000, "treeLines": ["0 window Notepad"]}}
    with patch(NATIVE, return_value=False):
        data = json.loads(run(nested))
    assert "screenshotPngBase64" not in data["snapshot"] and data["snapshot"]["treeLines"] == ["0 window Notepad"]
