# Multi-firm production deployment (one Web App per firm)

Each law firm gets its **own Azure Web App**, **own Smokeball OAuth application**, and **own middleware URL** in 3CX. The same Git repository and build deploy to every firm listed in `deploy/firms.json`.

---

## 1. Repository layout

| Path | Purpose |
|------|---------|
| `deploy/firms.json` | Firms to deploy (committed, no secrets) |
| `deploy/firms.json.example` | Sample multi-firm config |
| `deploy/firm.env.example` | Template for per-firm Application Settings |
| `deploy/firms/<firm-id>.env` | Firm secrets (gitignored) |
| `deploy/scripts/New-FirmWebApp.ps1` | Create Azure Web App |
| `deploy/scripts/Apply-FirmSettings.ps1` | Push env file to Azure |
| `deploy/scripts/New-FirmCrmTemplate.ps1` | Generate firm-specific 3CX XML |
| `deploy/generated/` | Generated CRM XML (gitignored contents optional) |

---

## 2. Onboard a new firm (checklist)

### Step A: Azure Web App

```powershell
./deploy/scripts/New-FirmWebApp.ps1 `
  -FirmId acme-law `
  -WebAppName smokeball3cx-acme `
  -ResourceGroup ITT-SMOKEBALL-RG `
  -Location australiaeast
```

Use `-CreatePlan` on first firm if you need a new App Service plan. Multiple firms can share one plan (B2 or higher for production load).

### Step B: Register the firm in `deploy/firms.json`

Add an object:

```json
{
  "id": "acme-law",
  "displayName": "Acme Law",
  "azureWebAppName": "smokeball3cx-acme",
  "publicUrl": "https://smokeball3cx-acme.azurewebsites.net",
  "githubEnvironment": "firm-acme-law",
  "smokeballApiUrl": "https://api.smokeball.com.au",
  "smokeballAuthUrl": "https://auth.smokeball.com.au"
}
```

Use staging URLs for pilot firms (`stagingapi.smokeball.com.au`, etc.).

### Step C: Application settings (secrets)

```powershell
Copy-Item deploy/firm.env.example deploy/firms/acme-law.env
# Edit acme-law.env with Smokeball Client ID, Secret, API key, staff default, journal flags

./deploy/scripts/Apply-FirmSettings.ps1 -FirmId acme-law -ResourceGroup ITT-SMOKEBALL-RG
```

### Step D: Smokeball developer portal

- Create a **separate** OAuth app for this firm.
- Redirect URI: `https://<firm-host>/auth/callback`
- Scopes: contacts, staff, matters, tasks, fees as required.

### Step E: GitHub deployment target

Create a GitHub **Environment** named `firm-acme-law` (must match `githubEnvironment` in `firms.json`).

Add secrets to that environment:

| Secret | Value |
|--------|--------|
| `AZURE_WEBAPP_PUBLISH_PROFILE` | Download from Azure Portal for this Web App |

The workflow uses the environment on each matrix job so each firm gets the correct publish profile.

Your existing single-firm setup can keep `githubEnvironment": "Production"` with the current `AZURE_WEBAPP_PUBLISH_PROFILE` secret.

**Optional (all firms, one login):** Set repository variable `USE_AZURE_OIDC=true` and configure `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. The workflow deploys every firm in `firms.json` without per-firm publish profiles.

### Step F: 3CX CRM template

```powershell
./deploy/scripts/New-FirmCrmTemplate.ps1 -FirmId acme-law -CrmDisplayName "Smokeball - Acme Law"
```

Upload `deploy/generated/3cx_smokeball_acme-law.xml` to **that firm's** 3CX server. Authorize with **that firm's** Smokeball credentials.

### Step G: Verify

- `https://<firm-host>/api/status`
- Test call and `/api/logs`
- See [ADMINISTRATION.md](./ADMINISTRATION.md)

---

## 3. CI/CD behavior

On push to `main` / `master`:

1. **Build** runs once (`npm ci`, tests).
2. **Prepare** reads `deploy/firms.json` (or falls back to legacy single `AZURE_WEBAPP_NAME` secret).
3. **Deploy** runs one job per firm (matrix), each using its `githubEnvironment` and `azureWebAppName`.

Adding a firm = add JSON entry + GitHub Environment + secrets + Azure app settings. No code fork.

---

## 4. Operations

| Task | Action |
|------|--------|
| Deploy code to all firms | Push to `master` |
| Change one firm's journal rules | Edit `deploy/firms/<id>.env`, run `Apply-FirmSettings.ps1` |
| Rotate Smokeball secret | Update `.env` file, apply settings, re-authorize 3CX CRM |
| Custom domain | Azure custom domain + update `publicUrl`, redirect URI, CRM template |
| Scale one firm | Scale that firm's App Service plan or instance count |

---

## 5. What stays isolated per firm

- Smokeball OAuth app and API key
- Refresh token (stored in 3CX)
- Journal configuration flags
- Rate limits (Smokeball per client id)
- Logs and failures (per App Service)

---

## 6. Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ADMINISTRATION.md](./ADMINISTRATION.md)
