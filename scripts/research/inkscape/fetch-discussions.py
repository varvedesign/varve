#!/usr/bin/env python3
"""Fetch Inkscape issue notes through GitLab GraphQL with resumable batches."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = "https://gitlab.com/api/graphql"
PROJECT = "inkscape/inkscape"
BATCH_SIZE = 7  # Eight aliases can exceed GitLab's public query complexity limit (200).
NOTES_PER_ISSUE = 100


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def post_query(query: str, retries: int = 6) -> dict:
    payload = json.dumps({"query": query}).encode()
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Varve-Inkscape-Audit/1.0"},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                body = json.load(response)
                if body.get("errors"):
                    raise RuntimeError(json.dumps(body["errors"], ensure_ascii=False))
                return body
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


def issue_notes_query(iid: int, after: str | None = None) -> str:
    cursor = f', after: "{after}"' if after else ""
    return f'''query {{ project(fullPath: "{PROJECT}") {{ issue(iid: "{iid}") {{ iid notes(first: {NOTES_PER_ISSUE}{cursor}) {{ nodes {{ id body createdAt system author {{ username }} }} pageInfo {{ hasNextPage endCursor }} }} }} }} }}'''


def batch_query(iids: list[int]) -> str:
    fields = " ".join(
        f'i{index}: issue(iid: "{iid}") {{ iid notes(first: {NOTES_PER_ISSUE}) {{ nodes {{ id body createdAt system author {{ username }} }} pageInfo {{ hasNextPage endCursor }} }} }}'
        for index, iid in enumerate(iids)
    )
    return f'query {{ project(fullPath: "{PROJECT}") {{ {fields} }} }}'


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=Path("docs/audits/inkscape/issue-ledger.jsonl"))
    parser.add_argument("--cache", type=Path, default=Path("/tmp/inkscape-corpus-2026-10-17/notes"))
    parser.add_argument("--delay", type=float, default=1.2, help="seconds between GraphQL requests")
    parser.add_argument("--limit", type=int, help="fetch only the first N pending issues (useful for a smoke check)")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    manifest_path = args.cache / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "source": ENDPOINT,
        "project": PROJECT,
        "ledger": str(args.ledger),
        "batch_size": BATCH_SIZE,
        "notes_per_issue_page": NOTES_PER_ISSUE,
        "started_at_utc": utc_now(),
        "completed_iids": [],
        "failed_iids": {},
        "retrieved_notes": 0,
        "retrieved_user_notes": 0,
        "requests": 0,
    }
    manifest.setdefault("retrieved_user_notes", 0)
    issues = [json.loads(line) for line in args.ledger.open()]
    pending = [issue["iid"] for issue in issues if issue["reported_note_count"] > 0 and str(issue["iid"]) not in manifest["completed_iids"]]
    if args.limit is not None:
        pending = pending[: args.limit]
    for offset in range(0, len(pending), BATCH_SIZE):
        batch = pending[offset : offset + BATCH_SIZE]
        try:
            response = post_query(batch_query(batch))
            manifest["requests"] += 1
            project = response.get("data", {}).get("project")
            if not isinstance(project, dict):
                raise RuntimeError("GraphQL response omitted project payload")
            for index, iid in enumerate(batch):
                issue = project.get(f"i{index}")
                if issue is None:
                    raise RuntimeError(f"GraphQL response omitted issue IID {iid}")
                connection = issue["notes"]
                notes = connection["nodes"]
                cursor = connection["pageInfo"]["endCursor"]
                while connection["pageInfo"]["hasNextPage"]:
                    page = post_query(issue_notes_query(iid, cursor))
                    manifest["requests"] += 1
                    connection = page["data"]["project"]["issue"]["notes"]
                    notes.extend(connection["nodes"])
                    cursor = connection["pageInfo"]["endCursor"]
                atomic_json(args.cache / f"{iid}.json", {"iid": iid, "fetched_at_utc": utc_now(), "notes": notes})
                manifest["retrieved_notes"] += len(notes)
                user_notes = sum(not note.get("system", False) for note in notes)
                manifest["retrieved_user_notes"] += user_notes
                manifest["completed_iids"].append(str(iid))
                manifest["failed_iids"].pop(str(iid), None)
                expected_for_issue = next(issue["reported_note_count"] for issue in issues if issue["iid"] == iid)
                if user_notes != expected_for_issue:
                    manifest.setdefault("note_count_mismatches", {})[str(iid)] = {
                        "expected": expected_for_issue,
                        "retrieved_user_notes": user_notes,
                        "retrieved_total_notes": len(notes),
                    }
                else:
                    manifest.get("note_count_mismatches", {}).pop(str(iid), None)
                atomic_json(manifest_path, manifest)
            manifest["last_batch_at_utc"] = utc_now()
            atomic_json(manifest_path, manifest)
        except Exception as error:  # Keep the batch resumable and record the failure.
            for iid in batch:
                manifest["failed_iids"][str(iid)] = f"{type(error).__name__}: {error}"
            manifest["last_error_at_utc"] = utc_now()
            atomic_json(manifest_path, manifest)
            raise
        print(f"completed {len(manifest['completed_iids'])}/{len([i for i in issues if i['reported_note_count'] > 0])} issues; {manifest['retrieved_notes']} notes", flush=True)
        time.sleep(args.delay)
    expected = sum(issue["reported_note_count"] for issue in issues)
    # Recompute from the durable cache so a process restart can reconcile a
    # completed crawl even if it ended between a note file and manifest write.
    total_notes = 0
    total_user_notes = 0
    mismatches = {}
    expected_by_iid = {issue["iid"]: issue["reported_note_count"] for issue in issues}
    for iid in manifest["completed_iids"]:
        payload = json.loads((args.cache / f"{iid}.json").read_text())
        notes = payload["notes"]
        user_count = sum(not note.get("system", False) for note in notes)
        total_notes += len(notes)
        total_user_notes += user_count
        if user_count != expected_by_iid[int(iid)]:
            mismatches[iid] = {"expected": expected_by_iid[int(iid)], "retrieved_user_notes": user_count, "retrieved_total_notes": len(notes)}
    manifest["retrieved_notes"] = total_notes
    manifest["retrieved_user_notes"] = total_user_notes
    manifest["note_count_mismatches"] = mismatches
    manifest["expected_user_notes_from_issue_list"] = expected
    manifest["complete"] = len(manifest["completed_iids"]) == len([i for i in issues if i["reported_note_count"] > 0])
    manifest["finished_at_utc"] = utc_now() if manifest["complete"] else None
    atomic_json(manifest_path, manifest)
    if manifest["complete"] and (manifest["retrieved_user_notes"] != expected or mismatches):
        raise SystemExit(f"user-note count mismatch: fetched {manifest['retrieved_user_notes']} non-system notes, issue list reports {expected}; {len(mismatches)} per-issue mismatches")


if __name__ == "__main__":
    main()
