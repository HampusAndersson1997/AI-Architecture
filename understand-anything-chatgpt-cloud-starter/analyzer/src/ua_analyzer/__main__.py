from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from . import __version__
from .analyze import analyze_project
from .archive import safe_extract_zip
from .validate import validate_graph


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(prog="ua-analyzer")
    subparsers = parser.add_subparsers(dest="command", required=True)
    analyze = subparsers.add_parser("analyze")
    analyze.add_argument("--source", type=Path, required=True)
    analyze.add_argument("--output", type=Path, required=True)
    analyze.add_argument("--project-id", required=True)
    analyze.add_argument("--source-version", required=True)
    analyze.add_argument("--archive", action="store_true", help="Treat --source as a ZIP archive and extract safely")
    args = parser.parse_args()

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    source = args.source.resolve()
    if args.archive:
        extracted = output / "source"
        safe_extract_zip(source, extracted)
        source = extracted
    graph = analyze_project(source, project_id=args.project_id, source_version=args.source_version)
    rendered = json.dumps(graph, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(rendered.encode()).hexdigest()
    validation = validate_graph(graph)
    if validation["issues"]:
        raise SystemExit("validation failed: " + "; ".join(validation["issues"]))
    search_index = [
        {"nodeId": node["id"], "text": " ".join([node["name"], node["summary"], node.get("filePath", ""), *node.get("tags", [])]).lower()}
        for node in graph["nodes"]
    ]
    now = datetime.now(UTC).isoformat()
    write_json(output / "knowledge-graph.json", graph)
    write_json(output / "validation.json", validation)
    write_json(output / "search-index.json", search_index)
    write_json(output / "meta.json", {
        "projectId": args.project_id,
        "sourceVersion": args.source_version,
        "schemaVersion": graph["version"],
        "analyzerVersion": __version__,
        "generatedAt": now,
        "sha256": digest,
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
    })
    print(json.dumps({"status": "completed", "output": str(output), "sha256": digest, "validation": validation}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
