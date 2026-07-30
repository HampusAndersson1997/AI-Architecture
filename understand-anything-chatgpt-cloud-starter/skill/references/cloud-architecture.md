# Free-First Cloud Architecture

## Decision

Use Cloudflare for the lightweight control plane and persistent web assets, and GitHub Actions for the heavyweight analyzer runtime.

```text
Custom GPT
  │ Bearer-authenticated OpenAPI Action
  ▼
Cloudflare Worker
  ├── D1: projects, jobs, versions, audit records
  ├── R2: uploads, graphs, indexes, exports
  ├── GitHub App/API: repository authorization and workflow dispatch
  └── Pages URL generation
          │
          ▼
GitHub Actions
  ├── acquire source
  ├── deterministic scan and batching
  ├── optional LLM enrichment
  ├── graph assembly and validation
  ├── fingerprints and metadata
  └── publish results
          │
          ▼
Cloudflare Pages dashboard
```

## Why this split

Cloudflare Workers Free is appropriate for authentication, metadata, signed URLs, status reads, and workflow dispatch. Its CPU limit is not appropriate for parsing repositories. GitHub Actions provides a complete Linux VM with Git, Node.js, Python, and several hours of job runtime.

R2 stores large immutable artifacts without putting graph JSON into D1. D1 stores queryable metadata and job state. Pages serves one dashboard application that loads a project graph by project ID; do not build a separate site per project.

## Free-tier guardrails

Current quotas must be treated as deployment inputs, not permanent truths. The service must expose a provider-health endpoint and keep the API contract provider-neutral.

Recommended controls:

- Configure GitHub billing budgets to stop paid Actions usage.
- Use public Actions only for public-source analysis.
- Keep private-repository analysis logs in a private analyzer repository.
- Enforce repository size, file count, upload size, and runtime ceilings before dispatch.
- Compress versioned graph JSON in R2 and retain only configured history.
- Keep generated data exportable as a ZIP containing graph, metadata, fingerprints, and reports.
- Store the provider and analyzer version with every graph version.

## Runtime paths

### Public GitHub repository

1. Worker validates and normalizes the GitHub URL.
2. Worker creates or reuses the project record.
3. Worker dispatches a public-safe analyzer workflow.
4. Action clones the exact requested commit.
5. Analyzer publishes graph and metadata to R2.
6. Worker marks the job completed only after validation and artifact verification.

### Private GitHub repository

1. User authorizes a narrowly scoped GitHub App.
2. Worker records the installation ID, never a long-lived repository token.
3. Worker generates a short-lived installation token when dispatching or cloning.
4. Private source and logs remain in private execution boundaries.
5. Optional third-party LLM enrichment remains disabled unless explicitly enabled.

### ZIP upload

1. Worker creates an expiring R2 upload URL.
2. User uploads directly to R2.
3. Worker verifies size, digest, MIME type, archive paths, and extraction limits.
4. Analyzer extracts into a sandbox and treats the archive as untrusted.
5. The upload digest becomes the immutable source version identifier.

## Persistence model

### D1 tables

- `projects`
- `project_sources`
- `jobs`
- `graph_versions`
- `github_installations`
- `upload_sessions`
- `audit_events`

### R2 keys

```text
projects/{project_id}/sources/{source_version}.zip
projects/{project_id}/graphs/{source_version}.json.gz
projects/{project_id}/graphs/latest.json.gz
projects/{project_id}/indexes/{source_version}.json.gz
projects/{project_id}/reports/{source_version}/onboarding.md
projects/{project_id}/exports/{source_version}.zip
```

## Analyzer contract

The analyzer must preserve the original workflow semantics:

1. Preflight and source identity
2. Ignore/exclusion policy
3. Project scan and language/framework detection
4. Semantic batching
5. File/component analysis
6. Merge and normalization
7. Architecture layers
8. Guided tour and domain views
9. Deterministic validation
10. Fingerprints, metadata, save, and publish

LLM enrichment is optional. Structural validity must not depend on a free model quota. Tree-sitter, import resolution, manifests, route/schema extraction, test pairing, and deterministic summaries form the required baseline.

## Replaceability

The stable interfaces are:

- OpenAPI operations and response shapes
- Project/source version identity
- Knowledge-graph schema
- Export format
- Dashboard graph-loading contract

Workers can later be replaced by another API host, D1 by PostgreSQL, R2 by S3-compatible storage, and GitHub Actions by Cloud Run Jobs or a self-hosted runner without changing the Custom GPT instructions.
