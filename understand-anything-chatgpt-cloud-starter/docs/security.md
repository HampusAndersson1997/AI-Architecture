# Security Model

## Trust boundaries

| Boundary | Trusted | Untrusted |
|---|---|---|
| Custom GPT → Worker | Configured Bearer credential and stable API contract | User-provided URLs, filenames, questions, exclusions |
| Worker → GitHub | Scoped GitHub credential and configured analyzer repository | Repository metadata, refs, source contents |
| GitHub Actions → source | Workflow code from the analyzer repository | Checked-out repository or downloaded ZIP |
| Analyzer → Worker | Shared callback secret and generated validation report | Graph fields derived from source text |
| Dashboard → Worker | Short-lived project-scoped token | Browser URL, local state, rendered graph text |

## Enforced controls

### API

- Every durable user operation requires the exact Bearer API key.
- API keys shorter than 16 characters are rejected by authentication logic.
- Comparison uses a length-independent byte loop to reduce trivial timing leakage.
- Callback authentication uses a separate secret.
- CORS allows only the exact configured dashboard origin.
- Dashboard, upload, and source-download links are scope-, subject-, and expiry-bound HMAC tokens. Browser-facing dashboard and upload capabilities are carried in URL fragments and then sent in dedicated request headers, reducing server and referrer logging exposure.
- Error responses do not expose stack traces or secret values.

### GitHub

- Repository URLs are restricted to canonical HTTPS `github.com/owner/repository` form.
- GitHub source analysis checks out an immutable 40-character commit SHA.
- The workflow has `contents: read` permission and a six-hour maximum.
- Workflow concurrency prevents duplicate runs for one project, version, and mode.
- The callback token comes from a GitHub secret, not a visible workflow input.
- Private source cloning uses a separate read-scoped repository token.

### Source handling

- Project package managers, install hooks, builds, tests, generators, and application entry points are never run.
- `.git` metadata is removed before analysis.
- Large, binary, generated, dependency, cache, and VCS directories are excluded.
- Text files larger than the analyzer limit are skipped rather than executed or interpreted.
- Repository prompt-like text cannot modify analyzer policy.

### ZIP handling

- Upload sessions accept only `.zip` names and enforce a byte limit.
- The analyzer rejects absolute paths, parent traversal, symlinks, excessive entry counts, excessive expanded size, and suspicious compression ratios.
- ZIP extraction writes only beneath a fresh analysis directory.
- Uploaded source is delivered to the workflow through an expiring project-specific URL, and the downloaded ZIP SHA-256 must equal the durable upload digest before extraction or analysis.

### Graph integrity

- Node IDs must be unique.
- Edge, layer, and tour references must point to existing nodes.
- Required node fields and array shapes are validated.
- Invalid generated graphs fail the job and are not persisted as the latest healthy graph.
- Stored graph artifacts carry a SHA-256 digest and validation metadata.
- Project query fallback returns insufficient-evidence wording rather than fabricating an answer.

## Secrets

Use independent random values for:

- `API_KEY`
- `ANALYZER_CALLBACK_TOKEN`
- `DASHBOARD_TOKEN_SECRET`
- `UPLOAD_TOKEN_SECRET`
- `SOURCE_DOWNLOAD_TOKEN_SECRET`
- `GITHUB_TOKEN`
- `SOURCE_REPOSITORY_TOKEN`

Do not reuse the API key as a token-signing or callback secret. Rotate a secret by updating both sides that consume it, then invalidate or wait out outstanding scoped links.

## Known limitations

- The starter is single-user and does not implement per-person authorization, teams, or audit identity.
- The Worker trusts the configured GitHub analyzer workflow repository. Protect its default branch and require review.
- A repository administrator with access to Actions inputs can see expiring source URLs during an upload analysis. The URL is short-lived and project-scoped but should still be treated as sensitive.
- The deterministic analyzer uses language parsers and heuristics, not a full compiler for every language.
- Incremental mode currently preserves idempotency and source-version semantics but performs a deterministic rebuild.
- Completed graphs are returned in the authenticated callback body; very large repositories may require a future direct-to-R2 artifact upload path to reduce Worker callback size and CPU pressure.
- Search is deterministic lexical relevance rather than embedding-based semantic retrieval.
