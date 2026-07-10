# Publishing

Releases are published to the VS Code Marketplace automatically by
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) when a `v*` tag is
pushed. Authentication uses **Microsoft Entra ID via GitHub OIDC** — no
Personal Access Token is ever created or stored (global Azure DevOps PATs
retire on 2026-12-01).

## One-time setup

You need an [Azure](https://portal.azure.com) account and a Marketplace
publisher. None of this stores a long-lived secret.

### 1. Marketplace publisher

Create the publisher **`myles-carrick`** at
<https://marketplace.visualstudio.com/manage> (skip if it already exists).
It must match the `publisher` field in `package.json`.

### 2. Entra ID app registration

In the [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** →
**App registrations** → **New registration** (single tenant is fine).

Record from the app's **Overview**:

- **Application (client) ID** → GitHub secret `AZURE_CLIENT_ID`
- **Directory (tenant) ID** → GitHub secret `AZURE_TENANT_ID`

### 3. Federated credential (the GitHub ⇄ Azure trust)

On the app → **Certificates & secrets** → **Federated credentials** →
**Add credential** → scenario **GitHub Actions deploying Azure resources**:

- Organization: `mylescarrick`
- Repository: `bun-deps-lens`
- Entity type: **Environment**, name: **`release`**

This produces the subject
`repo:mylescarrick/bun-deps-lens:environment:release`, which is exactly what
the workflow's `publish` job (with `environment: release`) presents.

### 4. Authorise the app on the publisher

Add the app registration's **service principal** as a member of the
`myles-carrick` publisher (Marketplace **Manage** page → publisher members)
with a publishing role (**Contributor**). This is what actually grants the
identity permission to publish.

### 5. GitHub configuration

- Repo → **Settings → Environments** → create an environment named
  **`release`** (optionally add required reviewers to gate publishes).
- Repo → **Settings → Secrets and variables → Actions** → add:
  - `AZURE_CLIENT_ID`
  - `AZURE_TENANT_ID`

## Cutting a release

```sh
# 1. Bump the version (edit package.json + CHANGELOG.md), commit.
# 2. Tag and push — this triggers verify → publish.
git tag v0.1.0
git push origin main --tags
```

The `verify` job (lint, typecheck, tests, `vsce package`) runs on every push
and PR; `publish` runs only on `v*` tags after `verify` passes.

## Publishing manually (fallback)

```sh
az login                       # sign in with an account authorised on the publisher
bun install
./node_modules/.bin/vsce publish --azure-credential --no-dependencies
```
