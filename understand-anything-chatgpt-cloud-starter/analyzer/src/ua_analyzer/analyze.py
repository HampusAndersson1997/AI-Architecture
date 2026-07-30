from __future__ import annotations

import ast
import os
import re
from pathlib import Path
from typing import Any

from .validate import validate_graph

IGNORED_DIRECTORIES = {
    ".git", ".hg", ".svn", ".ua", ".understand-anything", ".venv", "venv",
    "node_modules", "dist", "build", "coverage", "__pycache__", ".next", ".cache",
}
IGNORED_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".lock"}
MAX_TEXT_BYTES = 1_500_000
LANGUAGES = {
    ".py": "python", ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".jsx": "javascript", ".json": "json",
    ".md": "markdown", ".yml": "yaml", ".yaml": "yaml", ".toml": "toml",
    ".sql": "sql", ".html": "html", ".css": "css", ".sh": "shell",
}


def _read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_TEXT_BYTES:
            return None
        raw = path.read_bytes()
        if b"\x00" in raw[:4096]:
            return None
        return raw.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for current, directories, filenames in os.walk(root, topdown=True, followlinks=False):
        directories[:] = sorted(directory for directory in directories if directory not in IGNORED_DIRECTORIES)
        current_path = Path(current)
        for filename in sorted(filenames):
            path = current_path / filename
            if path.is_symlink() or path.suffix.lower() in IGNORED_SUFFIXES:
                continue
            files.append(path)
    return sorted(files, key=lambda item: item.relative_to(root).as_posix().lower())


def _node_type(relative: str) -> str:
    lower = relative.lower()
    name = Path(relative).name.lower()
    if name.startswith("readme") or lower.startswith("docs/") or Path(relative).suffix.lower() == ".md":
        return "document"
    if name in {"package.json", "pyproject.toml", "cargo.toml", "go.mod", "dockerfile"} or Path(relative).suffix.lower() in {".yaml", ".yml", ".toml", ".json"}:
        return "config"
    return "file"


def _summary(relative: str, language: str, node_type: str) -> str:
    if node_type == "document":
        return f"Documentation file {relative}."
    if node_type == "config":
        return f"{language.title()} configuration file {relative}."
    return f"{language.title()} source file {relative}."


def _python_symbols(relative: str, text: str) -> tuple[list[dict[str, Any]], list[str]]:
    nodes: list[dict[str, Any]] = []
    imports: list[str] = []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return nodes, imports

    class SymbolVisitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.scope: list[str] = []

        def qualified(self, name: str) -> str:
            return ".".join([*self.scope, name])

        def visit_ClassDef(self, item: ast.ClassDef) -> None:
            qualified = self.qualified(item.name)
            nodes.append({
                "id": f"class:{relative}#{qualified}", "type": "class", "name": qualified,
                "summary": f"Python class {qualified} defined in {relative}.", "filePath": relative,
                "startLine": item.lineno, "endLine": getattr(item, "end_lineno", item.lineno), "tags": ["python", "class"],
            })
            self.scope.append(item.name)
            self.generic_visit(item)
            self.scope.pop()

        def visit_FunctionDef(self, item: ast.FunctionDef) -> None:
            self._visit_function(item)

        def visit_AsyncFunctionDef(self, item: ast.AsyncFunctionDef) -> None:
            self._visit_function(item)

        def _visit_function(self, item: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
            qualified = self.qualified(item.name)
            nodes.append({
                "id": f"function:{relative}#{qualified}", "type": "function", "name": qualified,
                "summary": f"Python function {qualified} defined in {relative}.", "filePath": relative,
                "startLine": item.lineno, "endLine": getattr(item, "end_lineno", item.lineno), "tags": ["python", "function"],
            })
            self.scope.append(item.name)
            self.generic_visit(item)
            self.scope.pop()

    SymbolVisitor().visit(tree)
    for item in ast.walk(tree):
        if isinstance(item, ast.ImportFrom) and item.module:
            imports.append(item.module)
        elif isinstance(item, ast.Import):
            imports.extend(alias.name for alias in item.names)
    return nodes, imports


def _javascript_symbols(relative: str, text: str) -> tuple[list[dict[str, Any]], list[str]]:
    nodes: list[dict[str, Any]] = []
    imports = re.findall(r"(?:import[^'\"]*from\s*|require\s*\()\s*['\"]([^'\"]+)['\"]", text)
    patterns = [
        ("function", re.compile(r"\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")),
        ("class", re.compile(r"\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b")),
        ("function", re.compile(r"\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>")),
    ]
    seen: set[tuple[str, str]] = set()
    for symbol_type, pattern in patterns:
        for match in pattern.finditer(text):
            name = match.group(1)
            if (symbol_type, name) in seen:
                continue
            seen.add((symbol_type, name))
            line = text.count("\n", 0, match.start()) + 1
            nodes.append({
                "id": f"{symbol_type}:{relative}#{name}", "type": symbol_type, "name": name,
                "summary": f"JavaScript {symbol_type} {name} defined in {relative}.", "filePath": relative,
                "startLine": line, "endLine": line, "tags": ["javascript", symbol_type],
            })
    return nodes, imports


def _resolve_python_import(module: str, known_files: set[str]) -> str | None:
    candidate = module.replace(".", "/") + ".py"
    package = module.replace(".", "/") + "/__init__.py"
    if candidate in known_files:
        return candidate
    if package in known_files:
        return package
    return None


def _resolve_js_import(source_file: str, specifier: str, known_files: set[str]) -> str | None:
    if not specifier.startswith("."):
        return None
    base = (Path(source_file).parent / specifier).as_posix()
    candidates = [base, f"{base}.js", f"{base}.ts", f"{base}.jsx", f"{base}.tsx", f"{base}/index.js", f"{base}/index.ts"]
    normalized = [Path(candidate).as_posix() for candidate in candidates]
    return next((candidate for candidate in normalized if candidate in known_files), None)


def _layer_for(relative: str, node_type: str) -> str:
    lower = relative.lower()
    parts = set(Path(lower).parts)
    if "test" in parts or "tests" in parts or Path(lower).name.startswith("test_") or ".test." in lower:
        return "tests"
    if node_type == "document":
        return "documentation"
    if node_type == "config":
        return "configuration"
    if parts & {"web", "frontend", "ui", "client", "templates", "static"}:
        return "interface"
    if parts & {"db", "data", "models", "schema", "migrations"}:
        return "data"
    return "application"


def _project_description(root: Path) -> str:
    for name in ("README.md", "README.rst", "readme.md"):
        path = root / name
        text = _read_text(path) if path.exists() else None
        if text:
            for line in text.splitlines():
                clean = line.strip().lstrip("#").strip()
                if clean and not clean.lower().startswith(("badge", "![", "<")):
                    return clean[:300]
    return f"Deterministic analysis of {root.name}."


def analyze_project(root: Path, *, project_id: str, source_version: str) -> dict[str, Any]:
    root = root.resolve()
    files = _iter_files(root)
    relative_files = [path.relative_to(root).as_posix() for path in files]
    known_files = set(relative_files)
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []
    import_specs: dict[str, list[str]] = {}
    languages: set[str] = set()
    file_node_ids: list[str] = []

    for path, relative in zip(files, relative_files, strict=True):
        text = _read_text(path)
        if text is None:
            continue
        language = LANGUAGES.get(path.suffix.lower(), "text")
        languages.add(language)
        node_type = _node_type(relative)
        file_id = f"{node_type}:{relative}"
        file_node_ids.append(file_id)
        lines = text.count("\n") + (1 if text else 0)
        nodes.append({
            "id": file_id, "type": node_type, "name": Path(relative).name,
            "summary": _summary(relative, language, node_type), "filePath": relative,
            "startLine": 1, "endLine": max(1, lines), "tags": sorted({language, node_type}),
        })
        symbols: list[dict[str, Any]] = []
        imports: list[str] = []
        if language == "python":
            symbols, imports = _python_symbols(relative, text)
        elif language in {"javascript", "typescript"}:
            symbols, imports = _javascript_symbols(relative, text)
        for symbol in symbols:
            nodes.append(symbol)
            edges.append({"source": file_id, "target": symbol["id"], "type": "contains"})
        import_specs[relative] = imports

    file_id_by_path = {node["filePath"]: node["id"] for node in nodes if node["type"] in {"file", "config", "document"}}
    for source_file, specs in sorted(import_specs.items()):
        source_id = file_id_by_path.get(source_file)
        if not source_id:
            continue
        language = LANGUAGES.get(Path(source_file).suffix.lower(), "text")
        for specifier in sorted(set(specs)):
            target_file = _resolve_python_import(specifier, known_files) if language == "python" else _resolve_js_import(source_file, specifier, known_files)
            target_id = file_id_by_path.get(target_file) if target_file else None
            if target_id:
                edges.append({"source": source_id, "target": target_id, "type": "imports"})

    layer_specs = {
        "application": ("Application", "Core application and service code."),
        "interface": ("Interface", "User-facing and client-side code."),
        "data": ("Data", "Data models, schemas, and persistence code."),
        "configuration": ("Configuration", "Build, deployment, and runtime configuration."),
        "documentation": ("Documentation", "Project documentation and guides."),
        "tests": ("Tests", "Automated tests and verification code."),
    }
    layer_members: dict[str, list[str]] = {key: [] for key in layer_specs}
    for node in nodes:
        if node["type"] not in {"file", "config", "document"}:
            continue
        layer_members[_layer_for(node["filePath"], node["type"])].append(node["id"])
    layers = [
        {"id": layer_id, "name": layer_specs[layer_id][0], "description": layer_specs[layer_id][1], "nodeIds": sorted(layer_members[layer_id])}
        for layer_id in layer_specs if layer_members[layer_id]
    ]
    tour = [
        {"order": index, "title": f"Explore {layer['name']}", "description": layer["description"], "nodeIds": layer["nodeIds"][:8]}
        for index, layer in enumerate(layers, start=1)
    ]
    top_level_domains: dict[str, list[str]] = {}
    file_nodes_by_id = {node["id"]: node for node in nodes if node["type"] in {"file", "config", "document"}}
    for node_id, node in file_nodes_by_id.items():
        parts = Path(node["filePath"]).parts
        key = parts[0] if len(parts) > 1 else "root"
        top_level_domains.setdefault(key, []).append(node_id)
    domains = [
        {
            "id": f"domain:{key}",
            "name": "Project root" if key == "root" else key.replace("-", " ").replace("_", " ").title(),
            "description": f"Deterministic path-based grouping for {key}.",
            "nodeIds": sorted(node_ids),
        }
        for key, node_ids in sorted(top_level_domains.items())
    ]
    flows = []
    for layer in layers:
        steps = [
            {"order": order, "name": file_nodes_by_id[node_id]["name"], "nodeIds": [node_id]}
            for order, node_id in enumerate(layer["nodeIds"][:12], start=1)
            if node_id in file_nodes_by_id
        ]
        if steps:
            flows.append({
                "id": f"flow:{layer['id']}",
                "name": f"{layer['name']} navigation flow",
                "description": "Deterministic structural ordering; not inferred business semantics.",
                "steps": steps,
            })
    domain = {
        "generation": "deterministic-structural",
        "warning": "Path and architecture derived view; business semantics require explicit documentation or consented enrichment.",
        "domains": domains,
        "flows": flows,
    }
    graph = {
        "version": "1.0.0",
        "project": {
            "id": project_id,
            "name": root.name,
            "description": _project_description(root),
            "languages": sorted(languages),
            "frameworks": [],
            "sourceVersion": source_version,
        },
        "nodes": sorted(nodes, key=lambda node: node["id"]),
        "edges": sorted({(edge["source"], edge["target"], edge["type"]) for edge in edges}),
        "layers": layers,
        "tour": tour,
        "domain": domain,
    }
    graph["edges"] = [{"source": source, "target": target, "type": edge_type} for source, target, edge_type in graph["edges"]]
    validation = validate_graph(graph)
    if validation["issues"]:
        raise ValueError("invalid generated graph: " + "; ".join(validation["issues"]))
    return graph
