#!/usr/bin/env python3
"""Render an ephemeral Wrangler config and dashboard directory for CI deployment."""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse


REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
META_RE = re.compile(r'(<meta\s+name="ua-api-origin"\s+content=")[^"]*(">)')


def https_origin(value: str, field: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path not in ("", "/"):
        raise ValueError(f"{field} must be an HTTPS origin without a path")
    if parsed.params or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError(f"{field} must be a plain HTTPS origin")
    return value.rstrip("/")


def replace_assignment(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf'(?m)^{re.escape(key)}\s*=\s*"[^"]*"\s*$')
    replacement = f'{key} = "{value}"'
    updated, count = pattern.subn(replacement, text)
    if count != 1:
        raise ValueError(f"Expected exactly one {key} assignment")
    return updated


def render(args: argparse.Namespace) -> None:
    try:
        database_id = str(uuid.UUID(args.database_id))
    except ValueError as exc:
        raise ValueError("database-id must be a UUID") from exc

    api_origin = https_origin(args.api_origin, "api-origin")
    dashboard_origin = https_origin(args.dashboard_origin, "dashboard-origin")
    if not REPOSITORY_RE.fullmatch(args.analyzer_repository):
        raise ValueError("analyzer-repository must use owner/name format")

    wrangler_input = Path(args.wrangler_input)
    wrangler_output = Path(args.wrangler_output)
    dashboard_input = Path(args.dashboard_input)
    dashboard_output = Path(args.dashboard_output)

    if not wrangler_input.is_file():
        raise ValueError("wrangler input does not exist")
    if not dashboard_input.is_dir():
        raise ValueError("dashboard input does not exist")
    for path in dashboard_input.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"dashboard input contains a symlink: {path}")

    config = wrangler_input.read_text(encoding="utf-8")
    config = replace_assignment(config, "database_id", database_id)
    config = replace_assignment(config, "API_ORIGIN", api_origin)
    config = replace_assignment(config, "DASHBOARD_ORIGIN", dashboard_origin)
    config = replace_assignment(config, "ANALYZER_REPOSITORY", args.analyzer_repository)
    config = replace_assignment(config, "ANALYZER_WORKFLOW_REF", args.analyzer_workflow_ref)

    wrangler_output.parent.mkdir(parents=True, exist_ok=True)
    wrangler_output.write_text(config, encoding="utf-8")

    if dashboard_output.exists():
        shutil.rmtree(dashboard_output)
    shutil.copytree(dashboard_input, dashboard_output)
    index_path = dashboard_output / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index, count = META_RE.subn(rf'\1{api_origin}\2', index)
    if count != 1:
        raise ValueError("dashboard index must contain one ua-api-origin meta tag")
    index_path.write_text(index, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wrangler-input", required=True)
    parser.add_argument("--wrangler-output", required=True)
    parser.add_argument("--dashboard-input", required=True)
    parser.add_argument("--dashboard-output", required=True)
    parser.add_argument("--database-id", required=True)
    parser.add_argument("--api-origin", required=True)
    parser.add_argument("--dashboard-origin", required=True)
    parser.add_argument("--analyzer-repository", required=True)
    parser.add_argument("--analyzer-workflow-ref", default="main")
    return parser.parse_args()


def main() -> int:
    try:
        render(parse_args())
    except (OSError, ValueError) as exc:
        print(f"render-deployment: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
