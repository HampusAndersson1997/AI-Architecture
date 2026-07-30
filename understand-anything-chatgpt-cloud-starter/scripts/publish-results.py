#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def callback(status: str, *, phase: str, progress: int, error: str | None = None) -> None:
    url = os.environ["callback_url"]
    token = os.environ["callback_token"]
    payload: dict[str, object] = {
        "status": status,
        "phase": phase,
        "progress": progress,
        "source_version": os.environ["source_version"],
        "analyzer_version": "0.1.0",
    }
    if error:
        payload["error"] = error[:4000]
    if status == "completed":
        payload["graph"] = json.loads(Path("artifacts/knowledge-graph.json").read_text(encoding="utf-8"))
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, separators=(",", ":")).encode(),
        method="POST",
        headers={"content-type": "application/json", "x-callback-token": token},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError(f"callback returned {response.status}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"callback returned {exc.code}: {body[:1000]}") from exc


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in {"running", "completed", "failed"}:
        print("usage: publish-results.py running|completed|failed [message]", file=sys.stderr)
        return 2
    status = sys.argv[1]
    message = sys.argv[2] if len(sys.argv) > 2 else None
    if status == "running":
        callback("running", phase="preflight", progress=1)
    elif status == "completed":
        callback("completed", phase="complete", progress=100)
    else:
        callback("failed", phase="analyze", progress=0, error=message or "Analyzer workflow failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
