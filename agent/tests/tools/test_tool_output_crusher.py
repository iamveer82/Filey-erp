"""Long Filey tool lists reach the model as head, tail and odd rows with a count of the rest
(headroom SmartCrusher rules); small results and the rows that matter are never dropped."""
import json

from tools.tool_output_crusher import crush_json_text


def _files(n):
    rows = [{"name": f"Invoice {i:03}.pdf", "type": "application/pdf", "status": "saved", "size_kb": 100 + i}
            for i in range(n)]
    rows[20]["status"] = "upload failed"        # an error row in the middle
    rows[33]["type"] = "image/png"              # a rare value
    rows[40]["shared_with"] = "Ali"             # a rare field
    return rows


def test_long_list_keeps_head_tail_and_odd_rows_with_a_count():
    rows = _files(80)
    out = json.loads(crush_json_text(json.dumps({"count": 80, "files": rows})))
    names = [r["name"] for r in out["files"]]
    assert out["count"] == 80
    assert names[:5] == [r["name"] for r in rows[:5]] and names[-3:] == [r["name"] for r in rows[-3:]]
    assert {"Invoice 020.pdf", "Invoice 033.pdf", "Invoice 040.pdf"} <= set(names)
    assert len(names) < 30 and out["files_left_out"].startswith(f"{80 - len(names)} of 80 left out")


def test_small_or_non_json_results_pass_untouched():
    small = json.dumps({"files": _files(50)[:10]})
    assert crush_json_text(small) == small
    assert crush_json_text("x" * 9000) == "x" * 9000


def test_a_field_on_every_row_is_not_a_signal():
    rows = [{"id": i, "error_count": 0, "note": "ok " * 40} for i in range(50)]
    out = json.loads(crush_json_text(json.dumps({"rows": rows})))
    assert len(out["rows"]) == 15
