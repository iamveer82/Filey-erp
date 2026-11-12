"""A completed turn tells the client when another turn is already queued.

``_run_post_turn_followups`` starts a leftover ``/steer`` or a prompt queued during the
turn. Without the flag the desktop closed the stream at the first ``message.complete``
and the follow-up ran invisibly.
"""

from tui_gateway.prompt_turn import _turn_continues


def test_leftover_steer_continues():
    assert _turn_continues({}, {"pending_steer": "use the blue template"}) is True


def test_queued_prompt_continues():
    assert _turn_continues({"queued_prompt": {"text": "and the VAT note"}}, {}) is True
    assert _turn_continues({"queued_prompts": [{"text": "one"}, {"text": "two"}]}, {}) is True


def test_ordinary_turn_ends():
    assert _turn_continues({}, {"final_response": "done"}) is False
    assert _turn_continues({}, {"pending_steer": "   "}) is False
    assert _turn_continues({"queued_prompt": None}, None) is False
