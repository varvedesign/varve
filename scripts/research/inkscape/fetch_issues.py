#!/usr/bin/env python3
"""Rehydrate the frozen Inkscape issue corpus into a resumable local cache."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PROJECT = "inkscape/inkscape"
ENDPOINT = f"https://gitlab.com/api/v4/projects/{urllib.parse.quote(PROJECT, safe='')}"
DEFAULT_CACHE = Path.home() / ".cache" / "varve" / "inkscape-corpus-2026-10-17"
PAGE_SIZE = 100
CUTOFF_A = "2026-10-17T10:03:35Z"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def get_page(page_number: int, retries: int = 6) -> tuple[bytes, dict[str, str]]:
    query = urllib.parse.urlencode(
        {
            "state": "all",
            "per_page": PAGE_SIZE,
            "page": page_number,
            "order_by": "created_at",
            "sort": "asc",
        }
    )
    request = urllib.request.Request(
        f"{ENDPOINT}/issues?{query}",
        headers={"User-Agent": "Varve-Inkscape-Audit/1.0", "Accept": "application/json"},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                headers = {key.lower(): value for key, value in response.headers.items()}
                return response.read(), headers
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
            retry_after = error.headers.get("Retry-After")
            time.sleep(float(retry_after) if retry_after else min(2**attempt, 60))
        except (TimeoutError, urllib.error.URLError):
            if attempt == retries - 1:
                raise
            time.sleep(min(2**attempt, 60))
    raise RuntimeError("unreachable retry state")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=Path("docs/audits/inkscape/issue-ledger.jsonl"))
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--delay", type=float, default=0.25, help="seconds between API pages")
    args = parser.parse_args()

    with args.ledger.open(encoding="utf-8") as ledger_file:
        ledger_rows = [json.loads(line) for line in ledger_file]
    expected = {int(row["iid"]) for row in ledger_rows}
    cache = args.cache
    pages_dir = cache / "pages"
    issues_dir = cache / "issues"
    pages_dir.mkdir(parents=True, exist_ok=True)
    issues_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = cache / "issue-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {
        "project": PROJECT,
        "source": ENDPOINT,
        "cutoff_a_created_at_utc": CUTOFF_A,
        "expected_iid_count": len(expected),
        "started_at_utc": utc_now(),
        "completed_pages": [],
        "retrieved_iids": [],
        "follow_on_iids_created_after_cutoff_a": [],
        "page_snapshots": {},
    }
    manifest.setdefault("page_snapshots", {})
    manifest["expected_iid_count"] = len(expected)
    manifest.setdefault("completed_pages", [])
    manifest.setdefault("retrieved_iids", [])
    manifest.setdefault("follow_on_iids_created_after_cutoff_a", [])
    manifest.setdefault("unaccounted_pre_cutoff_iids", [])
    retrieved = set(map(int, manifest["retrieved_iids"]))
    completed_pages = set(map(int, manifest["completed_pages"]))
    follow_on = set(map(int, manifest["follow_on_iids_created_after_cutoff_a"]))
    unaccounted: set[int] = set()
    page_number = 1

    while True:
        page_path = pages_dir / f"page-{page_number:03}.json"
        if page_number in completed_pages and page_path.exists():
            raw = page_path.read_bytes()
            page_headers = manifest["page_snapshots"][str(page_number)].get("headers", {})
        else:
            raw, page_headers = get_page(page_number)
            page_path.write_bytes(raw)
            manifest["page_snapshots"][str(page_number)] = {
                "retrieved_at_utc": utc_now(),
                "row_count": len(json.loads(raw)),
                "sha256": hashlib.sha256(raw).hexdigest(),
                "headers": {
                    key: page_headers[key]
                    for key in ("x-total", "x-total-pages", "x-next-page")
                    if key in page_headers
                },
            }
            completed_pages.add(page_number)
            manifest["completed_pages"] = sorted(completed_pages)
            atomic_json(manifest_path, manifest)

        page_rows = json.loads(raw)
        if not isinstance(page_rows, list):
            raise RuntimeError(f"GitLab page {page_number} was not a JSON array")
        for issue in page_rows:
            iid = int(issue["iid"])
            created_at = issue.get("created_at", "")
            if created_at and created_at > CUTOFF_A:
                follow_on.add(iid)
            elif iid not in expected:
                unaccounted.add(iid)
            if iid in expected:
                atomic_json(issues_dir / f"{iid}.json", issue)
                retrieved.add(iid)
        manifest["retrieved_iids"] = sorted(retrieved)
        manifest["follow_on_iids_created_after_cutoff_a"] = sorted(follow_on)
        manifest["unaccounted_pre_cutoff_iids"] = sorted(unaccounted)
        manifest["last_page_at_utc"] = utc_now()
        atomic_json(manifest_path, manifest)
        print(f"page {page_number}: {len(retrieved)}/{len(expected)} baseline issues rehydrated", flush=True)

        next_page = page_headers.get("x-next-page", "").strip()
        if not next_page:
            if len(page_rows) == PAGE_SIZE:
                page_number += 1
                continue
            break
        page_number = int(next_page)
        time.sleep(args.delay)

    rows_seen: Counter[int] = Counter()
    total_page_rows = 0
    for page_path in sorted(pages_dir.glob("page-*.json")):
        page_rows = json.loads(page_path.read_text(encoding="utf-8"))
        total_page_rows += len(page_rows)
        rows_seen.update(int(issue["iid"]) for issue in page_rows if int(issue["iid"]) in expected)
    duplicates = {str(iid): count for iid, count in sorted(rows_seen.items()) if count > 1}
    manifest["total_page_rows"] = total_page_rows
    manifest["duplicate_baseline_iids"] = duplicates
    manifest["missing_iids"] = sorted(expected - retrieved)
    manifest["unexpected_follow_on_count"] = len(follow_on)
    manifest["unaccounted_pre_cutoff_iids"] = sorted(unaccounted)
    manifest["finished_at_utc"] = utc_now()
    manifest["complete"] = len(retrieved) == len(expected) and not duplicates
    atomic_json(manifest_path, manifest)
    if not manifest["complete"] or unaccounted:
        raise SystemExit(
            f"issue-body rehydration incomplete: {len(expected - retrieved)} baseline IIDs missing; "
            f"{len(duplicates)} duplicate baseline IIDs; "
            f"unaccounted pre-cutoff IIDs: {sorted(unaccounted)}"
        )


if __name__ == "__main__":
    main()
