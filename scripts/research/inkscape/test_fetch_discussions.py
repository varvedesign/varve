#!/usr/bin/env python3
"""Offline contract tests for the resumable Inkscape discussion crawler."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("fetch-discussions.py")
SPEC = importlib.util.spec_from_file_location("fetch_discussions", MODULE_PATH)
assert SPEC and SPEC.loader
fetch_discussions = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch_discussions)


def connection(notes: list[dict], *, has_next: bool = False, cursor: str | None = None) -> dict:
    return {
        "nodes": notes,
        "pageInfo": {"hasNextPage": has_next, "endCursor": cursor},
    }


class FetchDiscussionsTests(unittest.TestCase):
    def test_main_paginates_notes_and_reconciles_non_system_count(self) -> None:
        with tempfile.TemporaryDirectory(prefix="varve-inkscape-notes-test-") as directory:
            root = Path(directory)
            ledger = root / "ledger.jsonl"
            cache = root / "notes"
            ledger.write_text(
                json.dumps({"iid": 42, "reported_note_count": 2}) + "\n",
                encoding="utf-8",
            )
            user_note = {"id": "note-1", "body": "reporter reply", "system": False}
            system_note = {"id": "note-2", "body": "changed labels", "system": True}
            second_user_note = {"id": "note-3", "body": "maintainer reply", "system": False}
            responses = [
                {
                    "data": {
                        "project": {
                            "i0": {
                                "iid": "42",
                                "notes": connection([user_note, system_note], has_next=True, cursor="next"),
                            }
                        }
                    }
                },
                {
                    "data": {
                        "project": {
                            "issue": {"iid": "42", "notes": connection([second_user_note])}
                        }
                    }
                },
            ]

            with patch.object(fetch_discussions, "post_query", side_effect=responses) as post_query:
                with patch.object(
                    sys,
                    "argv",
                    ["fetch-discussions.py", "--ledger", str(ledger), "--cache", str(cache), "--delay", "0"],
                ):
                    fetch_discussions.main()

            self.assertEqual(post_query.call_count, 2)
            self.assertIn('after: "next"', post_query.call_args_list[1].args[0])
            saved = json.loads((cache / "42.json").read_text(encoding="utf-8"))
            self.assertEqual([note["id"] for note in saved["notes"]], ["note-1", "note-2", "note-3"])
            manifest = json.loads((cache / "manifest.json").read_text(encoding="utf-8"))
            self.assertTrue(manifest["complete"])
            self.assertEqual(manifest["retrieved_notes"], 3)
            self.assertEqual(manifest["retrieved_user_notes"], 2)
            self.assertEqual(manifest["note_count_mismatches"], {})

    def test_main_resume_reconciles_durable_cache_without_network(self) -> None:
        with tempfile.TemporaryDirectory(prefix="varve-inkscape-resume-test-") as directory:
            root = Path(directory)
            ledger = root / "ledger.jsonl"
            cache = root / "notes"
            cache.mkdir()
            ledger.write_text(json.dumps({"iid": 7, "reported_note_count": 1}) + "\n", encoding="utf-8")
            (cache / "manifest.json").write_text(
                json.dumps({"completed_iids": ["7"], "failed_iids": {}, "requests": 1}),
                encoding="utf-8",
            )
            (cache / "7.json").write_text(
                json.dumps({"iid": 7, "notes": [{"id": "note", "system": False}]}),
                encoding="utf-8",
            )

            with patch.object(fetch_discussions, "post_query") as post_query:
                with patch.object(
                    sys,
                    "argv",
                    ["fetch-discussions.py", "--ledger", str(ledger), "--cache", str(cache), "--delay", "0"],
                ):
                    fetch_discussions.main()

            post_query.assert_not_called()
            manifest = json.loads((cache / "manifest.json").read_text(encoding="utf-8"))
            self.assertTrue(manifest["complete"])
            self.assertEqual(manifest["retrieved_user_notes"], 1)
            self.assertEqual(manifest["expected_user_notes_from_issue_list"], 1)


if __name__ == "__main__":
    unittest.main()
