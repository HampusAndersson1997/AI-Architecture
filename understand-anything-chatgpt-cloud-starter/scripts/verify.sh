#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

printf '[1/9] JavaScript syntax\n'
while IFS= read -r -d '' file; do node --check "$file" >/dev/null; done < <(find packages -type f -name '*.js' -print0)

printf '[2/9] API tests\n'
node --test packages/api/test/*.test.js

printf '[3/9] Dashboard tests\n'
node --test packages/dashboard/test/*.test.js

printf '[4/9] Analyzer tests\n'
PYTHONPATH=analyzer/src python3 -m unittest discover analyzer/tests -v

printf '[5/9] Workflow and documentation contracts\n'
python3 -m unittest tests.test_workflow_contract tests.test_docs_contract -v

printf '[6/9] Shell and Python syntax\n'
bash -n scripts/run-analysis.sh scripts/verify.sh
python3 -m compileall -q analyzer/src analyzer/tests scripts tests skill/tests

printf '[7/9] OpenAPI and skill package\n'
python3 tests/verify_openapi.py
python3 skill/tests/verify_package.py

printf '[8/9] Analyzer CLI smoke test\n'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/source"
printf 'def main():\n    return 1\n' > "$TMP/source/main.py"
PYTHONPATH=analyzer/src python3 -m ua_analyzer analyze --source "$TMP/source" --output "$TMP/output" --project-id prj_smoke --source-version smoke123 >/dev/null
python3 - "$TMP/output" <<'PY'
import json
import sys
from pathlib import Path
root = Path(sys.argv[1])
for name in ("knowledge-graph.json", "meta.json", "search-index.json", "validation.json"):
    path = root / name
    if not path.is_file():
        raise SystemExit(f"missing smoke artifact: {name}")
    json.loads(path.read_text(encoding="utf-8"))
validation = json.loads((root / "validation.json").read_text(encoding="utf-8"))
if validation["issues"]:
    raise SystemExit("smoke graph validation failed")
PY

printf '[9/9] Repository hygiene\n'
if grep -nE '\b(TODO|TBD|FIXME)\b|api\.example\.com|REPLACE_WITH' README.md docs/deploy.md docs/custom-gpt.md docs/security.md openapi.yaml wrangler.toml; then
  echo 'Unresolved marker found' >&2
  exit 1
fi
git diff --check

printf 'FULL VERIFICATION PASSED\n'
