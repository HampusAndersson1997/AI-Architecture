from __future__ import annotations

from collections import Counter
from typing import Any


def validate_graph(graph: dict[str, Any]) -> dict[str, Any]:
    issues: list[str] = []
    warnings: list[str] = []
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    layers = graph.get("layers")
    tour = graph.get("tour")
    if not isinstance(nodes, list):
        issues.append("graph.nodes is missing or not an array")
        nodes = []
    if not isinstance(edges, list):
        issues.append("graph.edges is missing or not an array")
        edges = []
    if not isinstance(layers, list):
        issues.append("graph.layers is missing or not an array")
        layers = []
    if not isinstance(tour, list):
        issues.append("graph.tour is missing or not an array")
        tour = []

    node_ids = [node.get("id") for node in nodes if isinstance(node, dict)]
    counts = Counter(node_ids)
    for node_id, count in sorted(counts.items(), key=lambda item: str(item[0])):
        if node_id is None:
            issues.append("node missing id")
        elif count > 1:
            issues.append(f"duplicate node id: {node_id}")
    known = {node_id for node_id in node_ids if isinstance(node_id, str)}
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            issues.append(f"node[{index}] is not an object")
            continue
        for field in ("id", "type", "name", "summary"):
            if not isinstance(node.get(field), str) or not node[field]:
                issues.append(f"node[{index}] missing {field}")
        if not isinstance(node.get("tags"), list):
            issues.append(f"node[{index}] tags is not an array")
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            issues.append(f"edge[{index}] is not an object")
            continue
        if edge.get("source") not in known:
            issues.append(f"edge[{index}] source not found: {edge.get('source')}")
        if edge.get("target") not in known:
            issues.append(f"edge[{index}] target not found: {edge.get('target')}")
        if not isinstance(edge.get("type"), str) or not edge["type"]:
            issues.append(f"edge[{index}] missing type")
    for collection_name, collection in (("layer", layers), ("tour", tour)):
        for index, item in enumerate(collection):
            if not isinstance(item, dict) or not isinstance(item.get("nodeIds"), list):
                issues.append(f"{collection_name}[{index}] missing nodeIds")
                continue
            for node_id in item["nodeIds"]:
                if node_id not in known:
                    issues.append(f"{collection_name}[{index}] references missing node: {node_id}")
    connected = {edge.get("source") for edge in edges} | {edge.get("target") for edge in edges}
    for node_id in sorted(known - connected):
        warnings.append(f"node has no edges: {node_id}")
    return {
        "issues": issues,
        "warnings": warnings,
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "layers": len(layers),
            "tourSteps": len(tour),
        },
    }
