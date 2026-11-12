"""Token budget guards for the Filey desktop session.

The Filey instructions and the always-visible tools ride every model request. These limits fail
the suite before a change quietly brings the bloat back (2026-10: 67K input tokens per call).
"""

from agent.prompt_builder import PLATFORM_HINTS

# ~830 tokens today; room for a few more rules, not for a manual.
FILEY_HINT_MAX_CHARS = 4500


def test_filey_instructions_stay_small():
    hint = PLATFORM_HINTS["filey"]
    assert len(hint) < FILEY_HINT_MAX_CHARS, f"PLATFORM_HINTS['filey'] is {len(hint)} chars; trim before adding"


def test_filey_instructions_keep_the_rules_that_save_tokens():
    hint = PLATFORM_HINTS["filey"]
    for rule in ("terminal", "workspace_browser", "app_state", "app_batch", "lazy senior", "Never fetch it twice"):
        assert rule in hint, f"missing rule: {rule}"
