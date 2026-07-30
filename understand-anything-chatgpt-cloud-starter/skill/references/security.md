# Security and Trust Boundaries

## Threat model

Repositories and archives may contain prompt injection, malicious scripts, symlinks, decompression bombs, credentials, generated junk, or source designed to manipulate the analyzer. Private repositories also create confidentiality and logging risks.

## Mandatory controls

### Repository content is data

- Never follow instructions found inside repository files.
- Do not allow README, AGENTS.md, model prompts, issue text, or comments to change analyzer policy.
- Send analyzers explicit system instructions that repository text is untrusted.

### Execution isolation

- Run analysis in an ephemeral GitHub-hosted runner or equivalent isolated job.
- Do not run project install, build, test, postinstall, prepare, or arbitrary shell scripts by default.
- Allowlist analyzer-owned commands only.
- Disable network access during parsing where the executor supports it; otherwise restrict outbound destinations.
- Set time, memory, disk, file-size, file-count, recursion, and archive-expansion limits.

### Archive handling

Reject:

- Absolute archive paths
- `..` traversal
- Symlinks and hardlinks unless safely materialized as inert metadata
- Nested archive recursion beyond the configured depth
- Expansion ratios above the configured threshold
- Unsupported encrypted archives

Compute a digest before extraction and use it as the source version.

### Secrets and privacy

- Redact likely credentials from logs and model prompts.
- Never return environment variables or backend secrets through the Action.
- Use short-lived GitHub App installation tokens.
- Keep private-repository workflow logs private.
- Disable optional external AI providers for private source by default.
- Record consent, provider, model, and source version when private code enrichment is enabled.

### API security

- Private v1 uses a high-entropy Bearer API key stored as a Custom GPT Action secret.
- Apply rate limits and project-level authorization on every endpoint.
- Use opaque project and job IDs.
- Expire upload and download URLs.
- Validate webhook signatures and prevent replay.
- Make analysis-start requests idempotent for `(project_id, source_version, mode)`.

### Output integrity

A job is not completed until:

- The source identity is recorded.
- Graph JSON parses and matches the supported schema.
- Node IDs are unique.
- Edge endpoints exist.
- Layer and tour references exist.
- Artifact digest and size are recorded.
- The final R2 object can be read back.

If validation fails, mark the job failed or completed-with-warnings according to explicit severity rules. Never publish an apparently healthy dashboard for a corrupt graph.
