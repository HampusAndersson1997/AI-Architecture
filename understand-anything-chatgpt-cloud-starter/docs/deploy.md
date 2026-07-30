# Deployment Guide

This starter is published inside `HampusAndersson1997/AI-Architecture` under `understand-anything-chatgpt-cloud-starter/`. GitHub-executable workflows are therefore installed at the repository root:

- `.github/workflows/analyze.yml`
- `.github/workflows/deploy-understand-anything.yml`

## 1. Create Cloudflare resources

Authenticate Wrangler from a trusted local machine:

```bash
npx wrangler@latest login
```

Create the D1 database and R2 bucket:

```bash
npx wrangler@latest d1 create understand-anything
npx wrangler@latest r2 bucket create understand-anything-artifacts
```

Record the D1 database UUID returned by the first command. The deployment workflow checks for the R2 bucket and creates it when absent, but creating it explicitly makes the initial setup easier to verify.

Create a Pages project name, normally `ua-dashboard`. The deployment workflow creates the Pages project when it does not already exist.

## 2. Choose production origins

Choose the final origins before running deployment:

```text
Worker:    https://understand-anything-api.<account-subdomain>.workers.dev
Dashboard: https://ua-dashboard.pages.dev
```

The values must be plain HTTPS origins without paths, query strings, credentials, or fragments.

## 3. Generate application secrets

Generate independent values of at least 32 random bytes:

```bash
python3 - <<'PY'
import secrets
for name in (
    "UA_API_KEY",
    "UA_ANALYZER_CALLBACK_TOKEN",
    "UA_DASHBOARD_TOKEN_SECRET",
    "UA_UPLOAD_TOKEN_SECRET",
    "UA_SOURCE_DOWNLOAD_TOKEN_SECRET",
):
    print(f"{name}={secrets.token_urlsafe(32)}")
PY
```

Create a fine-grained GitHub token for `UA_GITHUB_TOKEN` with only the access required to:

- read repository metadata and commits for source repositories;
- dispatch Actions workflows in `HampusAndersson1997/AI-Architecture`.

For private source repositories, create a separate read-only token for `SOURCE_REPOSITORY_TOKEN`.

## 4. Configure GitHub Actions secrets

Open:

**AI-Architecture → Settings → Secrets and variables → Actions → Secrets**

Create these repository secrets:

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare token with Workers Scripts, D1, R2, and Pages edit access |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `CLOUDFLARE_D1_DATABASE_ID` | UUID returned by `wrangler d1 create` |
| `UA_API_KEY` | Bearer key used by the private Custom GPT Action |
| `UA_GITHUB_TOKEN` | Token used by the Worker to resolve commits and dispatch `analyze.yml` |
| `UA_ANALYZER_CALLBACK_TOKEN` | Secret shared between Worker and analyzer workflow |
| `ANALYZER_CALLBACK_TOKEN` | Exactly the same value as `UA_ANALYZER_CALLBACK_TOKEN` |
| `UA_DASHBOARD_TOKEN_SECRET` | Signing secret for expiring dashboard capabilities |
| `UA_UPLOAD_TOKEN_SECRET` | Signing secret for upload capabilities |
| `UA_SOURCE_DOWNLOAD_TOKEN_SECRET` | Signing secret for analyzer download capabilities |
| `SOURCE_REPOSITORY_TOKEN` | Optional read-only token for private source repositories |

GitHub reserves the automatic `GITHUB_TOKEN` name. The Worker therefore uses the separate `UA_GITHUB_TOKEN` secret.

## 5. Configure GitHub Actions variables

In the same settings area, open **Variables** and create:

| Variable | Example |
|---|---|
| `UA_API_ORIGIN` | `https://understand-anything-api.<account-subdomain>.workers.dev` |
| `UA_DASHBOARD_ORIGIN` | `https://ua-dashboard.pages.dev` |
| `UA_PAGES_PROJECT` | `ua-dashboard` |

## 6. Run deployment

Open:

**Actions → Deploy Understand Anything → Run workflow**

The workflow performs these gates in order:

1. validates every required secret and variable;
2. compiles Python modules and checks JavaScript syntax;
3. runs a deterministic analyzer smoke test;
4. renders an ephemeral Wrangler configuration and dashboard copy;
5. checks or creates the R2 bucket;
6. applies D1 migrations;
7. deploys the Worker with an ephemeral mode-`0600` secrets file;
8. checks or creates the Pages project;
9. deploys the dashboard;
10. verifies `GET /health` returns `{"status":"ok"}`;
11. removes the temporary secrets file in an `always()` cleanup step.

Generated configuration and secrets are never committed to the repository.

## 7. Configure the Custom GPT

After deployment succeeds:

1. Replace `servers[0].url` in `openapi.yaml` with `UA_API_ORIGIN` before importing the schema into the Custom GPT.
2. Follow [custom-gpt.md](custom-gpt.md).
3. Configure Action authentication with the exact `UA_API_KEY` value.

## 8. End-to-end smoke test

1. Create a project from a small public GitHub repository.
2. Start `full` analysis.
3. Poll the returned job ID until `completed`.
4. Confirm the reported source version is an immutable commit SHA.
5. Search for an entry-point term and inspect evidence.
6. Create dashboard access and open the expiring URL.
7. Create a ZIP upload session and analyze a safe test archive.
8. Confirm the dashboard graph, layers, tour, domain grouping, and version comparison load.

## Security and free-tier controls

- Repository contents are treated as untrusted data and are never executed by the analyzer.
- Private source code is not sent to optional inference providers by default.
- Deployment fails closed when secrets, origins, graph validation, or Cloudflare operations fail.
- There is no paid-provider fallback. Configure Cloudflare billing alerts and do not enable automatic paid overages.
- GitHub Actions concurrency prevents duplicate analyzer and production deployment runs from overlapping.
