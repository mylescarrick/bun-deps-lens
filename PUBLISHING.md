# Publishing

Releases are published to the VS Code Marketplace automatically by
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) when a `v*` tag is
pushed. Authentication uses **Microsoft Entra ID via GitHub OIDC** — after the
one-time bootstrap below, no long-lived secret is stored anywhere (global Azure
DevOps PATs retire on 2026-12-01).

## How the auth works (the mental model)

The Marketplace is backed by Azure DevOps. To publish without a stored password:

- An **Entra app registration** (a "service principal") is the identity that
  publishes.
- A **federated credential** on that app is a trust rule: it lets GitHub
  Actions log in **with no secret**, as long as the request provably comes from
  a specific repo + context. At run time GitHub mints a short-lived signed OIDC
  token describing the job; Azure checks its issuer + *subject* against the rule
  and, if they match, returns a ~1-hour access token. A different repo/branch
  produces a different subject and is rejected.
- The subject we trust is `repo:mylescarrick/bun-deps-lens:environment:release`,
  which is why the `publish` job runs in a GitHub environment named `release`.

## One-time setup

### 1. Marketplace publisher — DONE

Publisher **`myles-carrick`** at <https://marketplace.visualstudio.com/manage>.
Must match the `publisher` field in `package.json`.

### 2. Entra ID app registration — DONE

App **`vscode-bun-deps-lens`** (multitenant is fine). From its **Overview**:

- **Application (client) ID** `a5e55024-131e-41e8-9a98-f5d1f3ffa48f` → GitHub
  secret `AZURE_CLIENT_ID`
- **Directory (tenant) ID** `f5296a02-bc33-46a1-91e1-c52eda52c829` → GitHub
  secret `AZURE_TENANT_ID`

> The **Object ID** on the Overview blade is the app-registration object and is
> *not* used anywhere here — don't confuse it with the client ID.

### 3. Federated credential — DONE

App → **Certificates & secrets → Federated credentials → Add credential** →
scenario **GitHub Actions deploying Azure resources**:

- Organization `mylescarrick`, Repository `bun-deps-lens`
- Entity type **Environment**, name **`release`**

### 4. Materialise the service principal and add it to the publisher

The publisher's member list takes the SP's **Azure DevOps profile identity**,
not the client ID — and that identity only exists after the SP has signed in to
Azure DevOps once. To bootstrap it you need a real credential temporarily:

1. App → **Certificates & secrets → New client secret**; copy the value.
2. Sign in as the SP and hit the profile API (this materialises it). The SP has
   no Azure subscription, so `--allow-no-subscriptions` is expected:

   ```sh
   az login --service-principal \
     -u a5e55024-131e-41e8-9a98-f5d1f3ffa48f \
     -p '<CLIENT_SECRET>' \
     --tenant f5296a02-bc33-46a1-91e1-c52eda52c829 \
     --allow-no-subscriptions

   # 499b84ac-... is the fixed Azure DevOps resource ID
   az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
     --resource 499b84ac-1321-427f-aa17-267ca6975798
   ```

   Note the returned profile `id`
   (`c7368f0f-f5ef-6573-a0e1-de14200d74d7`). — DONE
3. At <https://marketplace.visualstudio.com/manage/publishers/myles-carrick> →
   **Members → Add**, add the SP using the profile **`id` UUID** from the JSON
   above — `c7368f0f-f5ef-6573-a0e1-de14200d74d7` — not the display name (the
   name search does not resolve the SP). Give it a role that can publish.
   — DONE
4. **Delete the temporary client secret** — CI uses the federated credential, so
   nothing stored. — TODO

### 5. GitHub configuration — TODO

- Repo → **Settings → Environments** → create **`release`** (optionally add
  required reviewers to gate publishes).
- Repo → **Settings → Secrets and variables → Actions** → add:
  - `AZURE_CLIENT_ID` = `a5e55024-131e-41e8-9a98-f5d1f3ffa48f`
  - `AZURE_TENANT_ID` = `f5296a02-bc33-46a1-91e1-c52eda52c829`

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
az login                       # an account authorised on the publisher
bun install
./node_modules/.bin/vsce publish --azure-credential --no-dependencies
```
