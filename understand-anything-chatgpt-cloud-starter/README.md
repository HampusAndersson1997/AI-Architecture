# Understand Anything for Normal Web ChatGPT — Cloud Starter

A deployable private integration that adapts the Understand Anything workflow to normal web ChatGPT without requiring a local CLI.

## Included

- **Cloudflare Worker API** with the stable Custom GPT Action contract
- **D1 metadata** and **R2 artifact storage**
- **GitHub Actions analyzer runtime** for public repositories, authorized private repositories, and uploaded ZIP archives
- **Dependency-free deterministic analyzer** for files, symbols, imports, layers, tours, validation, and safe ZIP extraction
- **Private static dashboard** with structural graph, layers, guided tour, search/filtering, node details, and domain-state warnings
- **Private Custom GPT skill package** under `skill/`
- **Tests and verification evidence** for API, security boundaries, analyzer, workflow, dashboard, and documentation

## Architecture

```text
Private Custom GPT
        │ Bearer-authenticated OpenAPI Action
        ▼
Cloudflare Worker
  ├── D1: projects, jobs, graph versions, uploads
  ├── R2: ZIP sources and validated graph artifacts
  └── scoped links: upload, source download, dashboard
        │ workflow_dispatch
        ▼
GitHub Actions
  ├── immutable repository checkout or safe ZIP download
  ├── deterministic analyzer
  └── authenticated callback
        │
        ▼
Cloudflare Pages dashboard
```

## Local verification

Requirements: Node.js 22+, Python 3.11+, Git, and Bash.

```bash
bash scripts/verify.sh
```

No application dependency installation is required. The implementation uses JavaScript ES modules, Node's built-in test runner, and Python's standard library.

## Deployment

Follow [docs/deploy.md](docs/deploy.md), then configure the private GPT using [docs/custom-gpt.md](docs/custom-gpt.md).

The example deployment names are:

- Worker: `understand-anything-api`
- D1: `understand-anything`
- R2: `understand-anything-artifacts`
- Pages: `ua-dashboard`

Change the example Worker and Pages domains in `wrangler.toml` and `openapi.yaml` after Cloudflare assigns the real domains.

## Supported workflows

- Public GitHub repository analysis
- Private GitHub repository analysis with scoped GitHub credentials
- ZIP project upload through an expiring browser page
- Full analysis, deterministic review-only validation, and incremental-request mode
- Job status polling
- Graph search and evidence-backed deterministic questions
- Persisted graph version comparison
- Expiring private dashboard links with structural, layer, tour, deterministic domain, and persisted-version diff views

The starter currently rebuilds deterministically for both full and incremental requests. The API preserves incremental mode and source-version idempotency so structural fingerprint-based partial analysis can be added without changing the Custom GPT contract.

## Security defaults

- Private, single-user API key
- Separate callback and scoped-link secrets
- Repository text treated as hostile data
- No repository install, build, test, hook, or application script execution
- Immutable Git commit checkout
- ZIP traversal, symlink, decompression-size, entry-count, and compression-ratio defenses
- No external AI inference in the required analysis path
- Validation failure blocks graph persistence and healthy job completion

See [docs/security.md](docs/security.md) for the complete trust model.

## Upstream

This starter is an adaptation layer for the MIT-licensed Egonex-AI Understand Anything project. Review and preserve applicable upstream license and copyright notices when incorporating upstream source code.
