#!/usr/bin/env python3
"""Offline contract tests for Inkscape issue-body cache recovery."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("fetch_issues.py")
SPEC = importlib.util.spec_from_file_location("fetch_issues", MODULE_PATH)
assert SPEC and SPEC.loader
fetch_issues = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch_issues)


class FetchIssuesTests(unittest.TestCase):
    def test_main_resumes_pages_and_separates_post_cutoff_issues(self) -> None:
        with tempfile.TemporaryDirectory(prefix="varve-inkscape-issues-test-") as directory:
            root = Path(directory)
            ledger = root / "ledger.jsonl"
            cache = root / "cache"
            ledger.write_text(
                "".join(
                    json.dumps({"iid": iid}) + "\n"
                    for iid in (1, 2)
                ),
                encoding="utf-8",
            )
            pages = {
                1: (
                    json.dumps(
                        [
                            {"iid": 1, "created_at": "2020-01-01T00:00:00Z", "description": "body 1"},
                            {"iid": 99, "created_at": "2026-10-18T00:00:00Z", "description": "later"},
                        ]
                    ).encode(),
                    {"x-next-page": "2", "x-total-pages": "2"},
                ),
                2: (
                    json.dumps(
                        [{"iid": 2, "created_at": "2021-01-01T00:00:00Z", "description": "body 2"}]
                    ).encode(),
                    {"x-next-page": "", "x-total-pages": "2"},
                ),
            }

            with patch.object(fetch_issues, "get_page", side_effect=lambda page: pages[page]) as get_page:
                with patch.object(
                    sys,
                    "argv",
                    ["fetch_issues.py", "--ledger", str(ledger), "--cache", str(cache), "--delay", "0"],
                ):
                    fetch_issues.main()

            self.assertEqual(get_page.call_count, 2)
            manifest_path = cache / "issue-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertTrue(manifest["complete"])
            self.assertEqual(manifest["expected_iid_count"], 2)
            self.assertEqual(manifest["retrieved_iids"], [1, 2])
            self.assertEqual(manifest["follow_on_iids_created_after_cutoff_a"], [99])
            self.assertEqual(
                json.loads((cache / "issues" / "2.json").read_text(encoding="utf-8"))["description"],
                "body 2",
            )

            with patch.object(fetch_issues, "get_page") as get_page:
                with patch.object(
                    sys,
                    "argv",
                    ["fetch_issues.py", "--ledger", str(ledger), "--cache", str(cache), "--delay", "0"],
                ):
                    fetch_issues.main()
            get_page.assert_not_called()


if __name__ == "__main__":
    unittest.main()
