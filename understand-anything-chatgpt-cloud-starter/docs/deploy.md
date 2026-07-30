# Deployment Guide

## 1. Verify locally

```bash
bash scripts/verify.sh
```

The command must exit with status 0 before deployment.

## 2. Push the starter to GitHub

Create a private repository and push this branch. The repository hosts the analyzer workflow.

```bash
git remote add origin git@github.com:YOUR_GITHUB_USER/understand-anything-chatgpt-cloud-starter.git
git push -u origin feat/cloud-starter
```

Merge the branch to `main` after review because the Worker dispatches the workflow from `main` by default.

## 3. Create Cloudflare resources

Authenticate Wrangler:

```bash
npx wrangler@latest login
```

Create D1 and R2:

```bash
npx wrangler@latest d1 create understand-anything
npx wrangler@latest r2 bucket create understand-anything-artifacts
```

Copy the D1 UUID printed by the first command into `wrangler.toml` as `database_id`.

Set these values in `wrangler.toml`:

```toml
API_ORIGIN = "https://YOUR_WORKER_SUBDOMAIN.workers.dev"
DASHBOARD_ORIGIN = "https://YOUR_PAGES_SUBDOMAIN.pages.dev"
ANALYZER_REPOSITORY = "YOUR_GITHUB_USER/understand-anything-chatgpt-cloud-starter"
ANALYZER_WORKFLOW_REF = "main"
```

Apply the migration:

```bash
npx wrangler@latest d1 migrations apply understand-anything --remote
```

## 4. Generate secrets

Generate five independent application secrets. Keep each value at least 32 random bytes. GitHub access tokens are created separately with scoped permissions.

```bash
python3 - <<'PY'
import secrets
for name in (
    "API_KEY",
    "ANALYZER_CALLBACK_TOKEN",
    "DASHBOARD_TOKEN_SECRET",
    "UPLOAD_TOKEN_SECRET",
    "SOURCE_DOWNLOAD_TOKEN_SECRET",
):
    print(f"{name}={secrets.token_urlsafe(32)}")
PY
```

Create a fine-grained GitHub token for the Worker with:

- Read access to repository metadata and commits for source repositories
- Actions write access to the analyzer repository

Store Worker secrets:

```bash
npx wrangler@latest secret put API_KEY
npx wrangler@latest secret put GITHUB_TOKEN
npx wrangler@latest secret put ANALYZER_CALLBACK_TOKEN
npx wrangler@latest secret put DASHBOARD_TOKEN_SECRET
npx wrangler@latest secret put UPLOAD_TOKEN_SECRET
npx wrangler@latest secret put SOURCE_DOWNLOAD_TOKEN_SECRET
```

## 5. Configure GitHub Actions secrets

In the analyzer repository, open **Settings → Secrets and variables → Actions**.

Create:

- `ANALYZER_CALLBACK_TOKEN`: exactly the same value stored in the Worker
- `SOURCE_REPOSITORY_TOKEN`: a fine-grained token that can read the private source repositories you intend to analyze

For public-only analysis, `SOURCE_REPOSITORY_TOKEN` may be omitted.

Do not put the callback token in workflow inputs. The workflow reads it only from the GitHub secret store.

## 6. Deploy the Worker

```bash
npx wrangler@latest deploy
```

Confirm:

```bash
curl https://YOUR_WORKER_SUBDOMAIN.workers.dev/health
```

Expected response:

```json
{"status":"ok"}
```

Update the `servers[0].url` value in `openapi.yaml` to the real Worker URL.

## 7. Deploy the dashboard to Pages

Create and deploy one static Pages project:

```bash
npx wrangler@latest pages project create ua-dashboard --production-branch main
npx wrangler@latest pages deploy packages/dashboard --project-name ua-dashboard
```

Set the exact assigned Pages origin in `wrangler.toml` as `DASHBOARD_ORIGIN`, then redeploy the Worker.

Set the Worker origin in `packages/dashboard/index.html`:

```html
<meta name="ua-api-origin" content="https://YOUR_WORKER_SUBDOMAIN.workers.dev">
```

Deploy Pages again after editing the meta tag.

## 8. Configure the Custom GPT

Follow [custom-gpt.md](custom-gpt.md).

## 9. Smoke test

1. Create a project from a small public GitHub repository.
2. Start `full` analysis.
3. Poll the returned job ID until `completed`.
4. Search for an entry-point term.
5. Ask one graph question and confirm evidence is returned.
6. Create dashboard access and open the expiring URL.
7. Create a ZIP upload session, open `upload_page_url`, upload a safe test ZIP, and analyze its project ID.
8. Confirm an invalid graph callback fails and leaves the job in `failed` state using the automated tests rather than a production callback.

## Free-tier safety

The system has no paid-provider fallback. Cloudflare or GitHub quota errors surface as failures. Configure billing alerts and avoid enabling automatic paid overages. GitHub Actions concurrency is keyed by project, source version, and mode to prevent accidental duplicate runs.
