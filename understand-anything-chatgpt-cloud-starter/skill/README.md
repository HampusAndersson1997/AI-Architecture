# Understand Anything for Normal Web ChatGPT

This package adapts the Understand Anything workflow to a private Custom GPT backed by persistent cloud services.

## What this package contains

- `SKILL.md` — reusable orchestration skill.
- `references/custom-gpt-instructions.md` — instructions to paste into the Custom GPT editor.
- `references/openapi.yaml` — Custom GPT Action schema.
- `references/cloud-architecture.md` — provider and deployment design.
- `references/security.md` — security requirements.
- `tests/acceptance-scenarios.md` — behavioral test suite.
- `tests/verify_package.py` — structural verifier.
- `docs/superpowers/specs/2026-07-30-understand-anything-chatgpt-design.md` — approved design specification.

## Intended deployment

```text
Private Custom GPT
        │ OpenAPI Action
        ▼
Cloudflare Worker ── D1 metadata ── R2 graphs/uploads
        │
        ▼
GitHub Actions analyzer
        │
        ▼
Cloudflare Pages dashboard
```

The Action is the durable boundary. Provider-specific internals can be replaced without rewriting the skill when the API contract remains compatible.

## Installation sequence

1. Deploy the API and analyzer described in `references/cloud-architecture.md`.
2. Replace `https://api.example.com` in `references/openapi.yaml` with the deployed Worker domain.
3. Import the OpenAPI schema in **Custom GPT → Configure → Actions**.
4. Configure Bearer API-key authentication for the private single-user version.
5. Paste `references/custom-gpt-instructions.md` into the GPT Instructions field.
6. Add the skill files as GPT Knowledge only if desired; the complete instructions and Action schema are the operational requirements.
7. Test every scenario in `tests/acceptance-scenarios.md` before relying on private repositories.

## Verification

Run:

```bash
python tests/verify_package.py
```

This validates required files, skill frontmatter, safety wording, and required OpenAPI operations. Behavioral scenarios still require testing in the Custom GPT Preview environment after the backend exists.

## Scope

Version 1 is private and single-user. It supports public GitHub repositories, authorized private GitHub repositories, and external ZIP upload sessions. Multi-user accounts, billing, team permissions, and public GPT Store distribution are deliberately excluded.

## Upstream attribution

This adaptation is designed around the MIT-licensed Understand Anything project by Egonex-AI. Reusing or distributing upstream source code requires retaining its applicable copyright and license notices.
