# Smokeball + 3CX Integration Middleware

Node.js middleware that connects **3CX Phone System** to **Smokeball** (Australian legal practice management CRM). It handles OAuth on behalf of the PBX, looks up contacts by phone number for caller ID, and can receive call journal events from 3CX.

---

## Overview

3CX cannot talk to Smokeball directly because:

- Smokeball’s OAuth redirect URI is registered for the **middleware** (e.g. Vercel), not each PBX hostname.
- 3CX always sends its own callback URL (`https://<pbx-fqdn>/api/oauth2crm`) during authorization.
- Smokeball has no API to search contacts by phone number.

This app sits in the middle: it proxies OAuth, rewrites redirect URIs, forwards the auth code back to 3CX, and searches Smokeball contacts by phone for caller ID lookup.

---

## Architecture

```mermaid
flowchart TB
    subgraph pbx [3CX PBX]
        Admin[Admin Console]
        CRM[CRM Integration XML]
        OAuth3CX["/api/oauth2crm"]
    end

    subgraph middleware [Middleware - Vercel / Node]
        AuthZ["/api/3cx/oauth2/authorize"]
        Callback["/auth/callback"]
        Token["/api/3cx/oauth2/token"]
        Lookup["/api/3cx/lookup"]
        Journal["/api/3cx/journal"]
    end

    subgraph smokeball [Smokeball]
        AuthServer[OAuth Server]
        API[Contacts API]
    end

    Admin -->|Load XML + Authorize| CRM
    CRM -->|OAuth start| AuthZ
    AuthZ -->|redirect_uri = middleware callback| AuthServer
    AuthServer -->|auth code| Callback
    Callback -->|forwards code| OAuth3CX
    CRM -->|token exchange| Token
    Token --> AuthServer
    CRM -->|incoming call lookup| Lookup
    Lookup --> API
    CRM -->|optional call journal| Journal
```

---

## How OAuth works (proxy mode — recommended)

**Proxy mode** (`SMOKEBALL_OAUTH_MODE=proxy`) is the default and matches a Smokeball app registered with the **middleware callback URL**.

| Step | Who | What happens |
|------|-----|----------------|
| 1 | User in 3CX | Clicks **Authorize** on the CRM integration |
| 2 | 3CX | Opens `{MiddlewareUrl}/api/3cx/oauth2/authorize` with `redirect_uri=https://<pbx>/api/oauth2crm` and PKCE `code_challenge` |
| 3 | Middleware | Stores the PBX redirect URL in base64 `state`, sends Smokeball `redirect_uri={MiddlewareUrl}/auth/callback` |
| 4 | Smokeball | User logs in and approves access |
| 5 | Smokeball | Redirects browser to `{MiddlewareUrl}/auth/callback?code=...&state=...` |
| 6 | Middleware | Decodes `state`, redirects browser to `https://<pbx>/api/oauth2crm?code=...&state=...` |
| 7 | 3CX | Exchanges code via `{MiddlewareUrl}/api/3cx/oauth2/token` |
| 8 | Middleware | Rewrites `redirect_uri` in the token request to the middleware callback (must match step 3) |
| 9 | Smokeball | Returns `access_token` and `refresh_token` |
| 10 | 3CX | Stores refresh token; uses access token on subsequent API calls |

### Passthrough mode (alternative)

Set `SMOKEBALL_OAUTH_MODE=passthrough` only if Smokeball’s developer portal registers the **3CX PBX callback** exactly:

`https://<your-pbx-fqdn>/api/oauth2crm`

Use this when you cannot register the middleware URL in Smokeball. The middleware forwards 3CX’s `redirect_uri` unchanged.

---

## Caller ID lookup flow

When a call arrives, 3CX calls the middleware:

```
GET /api/3cx/lookup?number={phone}
Authorization: Bearer {access_token}
```

The middleware:

1. Validates the Bearer token from 3CX.
2. Queries Smokeball `GET /contacts/` with the `Search` parameter (e.g. `phone:*412345678*`) — typically one API call per lookup instead of paging the full contact list.
3. Verifies matches locally on person (`phone`, `phone2`, `cell`) and company (`phone`) using suffix matching (handles different formats).
4. Retries on `429 Too Many Requests` and `5xx` errors with exponential backoff (honors `Retry-After` when present).
5. Returns a JSON payload 3CX expects:

```json
{
  "contacts": [{
    "id": "...",
    "firstName": "...",
    "lastName": "...",
    "company": "...",
    "phone": "...",
    "email": "...",
    "contactUrl": "https://app.smokeball.com.au/contacts/{id}"
  }]
}
```

If no match is found, it returns `{ "contacts": [] }`.

---

## Call journaling

When enabled in the 3CX template, 3CX POSTs call details to:

```
POST /api/3cx/journal
Authorization: Bearer {access_token}
```

The middleware currently **logs** these events and returns `{ "status": "received" }`. Writing call notes back into Smokeball is not implemented yet.

---

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/3cx/oauth2/authorize` | OAuth authorize proxy (3CX → Smokeball) |
| `POST` | `/api/3cx/oauth2/token` | OAuth token proxy (3CX ↔ Smokeball) |
| `GET` | `/api/3cx/lookup?number=` | Contact lookup by phone |
| `POST` | `/api/3cx/journal` | Receive call journal events |
| `GET` | `/auth/callback` | OAuth callback (Smokeball → middleware → 3CX) |
| `GET` | `/api/smokeball/contacts` | Debug: list contacts (requires Bearer token) |
| `GET` | `/api/smokeball/contacts/search?phone=` | Debug: search by phone |
| `GET` | `/api/status` | Health check for dashboard |
| `GET` | `/api/logs` | Recent server logs for dashboard |
| `GET` | `/` | Web dashboard |

Legacy paths `/lookup` and `/journal` (without `/api/3cx`) are supported for older templates.

---

## Project structure

```
├── server.js                      # Express entry point
├── vercel.json                    # Vercel deployment config
├── 3cx_smokeball_template_fixed.xml   # 3CX CRM template (load into PBX)
├── public/index.html              # Admin dashboard
└── src/
    ├── config.js                  # Environment configuration
    ├── logger.js                  # Winston + in-memory log buffer
    ├── routes/
    │   ├── 3cx.js                 # OAuth proxy, lookup, journal
    │   ├── smokeball.js           # Direct API routes (debug)
    │   └── auth.js                # Legacy info routes
    ├── services/smokeball.js      # Smokeball API client
    └── utils/auth.js              # Bearer token helpers
```

---

## Environment variables

Copy `.env.example` to `.env` for local development.

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Local server port (default `3000`) |
| `SMOKEBALL_CLIENT_ID` | Yes | OAuth client ID from Smokeball |
| `SMOKEBALL_CLIENT_SECRET` | Yes | OAuth client secret |
| `SMOKEBALL_API_KEY` | Yes | API key header for Smokeball REST API |
| `SMOKEBALL_AUTH_URL` | Yes | OAuth host only, e.g. `https://datastaging-auth.smokeball.com.au` |
| `SMOKEBALL_API_URL` | Yes | API base URL, e.g. `https://stagingapi.smokeball.com.au` (production: `https://api.smokeball.com.au`) |
| `SMOKEBALL_APP_URL` | No | Web app base for ContactUrl links from 3CX (default `https://app.smokeball.com.au`) |
| `SMOKEBALL_REDIRECT_URI` | Yes | Middleware OAuth callback, e.g. `https://your-app.vercel.app/auth/callback` |
| `SMOKEBALL_OAUTH_MODE` | No | `proxy` (default) or `passthrough` |
| `PUBLIC_URL` | No | Public base URL for logging and dashboard |
| `SMOKEBALL_MAX_RETRIES` | No | Retries on 429/5xx (default `3`) |
| `SMOKEBALL_RETRY_BASE_DELAY_MS` | No | Initial backoff delay in ms (default `500`) |
| `SMOKEBALL_SEARCH_LIMIT` | No | Max contacts returned per search query (default `50`) |

**Never commit `.env`** — it is listed in `.gitignore`.

---

## Deploying for a new client

Use this checklist for each new customer (PBX + Smokeball firm).

### 1. Smokeball developer setup

- [ ] Create (or reuse) an OAuth application in Smokeball’s developer portal.
- [ ] Register the **middleware callback URL** (proxy mode):
  ```
  https://<your-middleware-host>/auth/callback
  ```
- [ ] Note the **Client ID**, **Client Secret**, and **API Key**.
- [ ] Confirm staging vs production URLs:
  - Staging auth: `https://datastaging-auth.smokeball.com.au`
  - Staging API: `https://stagingapi.smokeball.com.au`
  - Production auth: `https://auth.smokeball.com.au`
  - Production API: `https://api.smokeball.com.au`

### 2. Middleware deployment

Choose one deployment per client **or** a shared multi-tenant instance (current design is single-tenant per env vars).

**Option A — Shared middleware (multiple clients, same Smokeball app)**  
Only works if all clients share the same Smokeball OAuth app credentials.

**Option B — Per-client middleware (recommended)**  
Deploy a separate Vercel project (or instance) per client with their own env vars.

| Setting | What to set |
|---------|-------------|
| Vercel project | New project or fork from template repo |
| `SMOKEBALL_CLIENT_ID` | Client’s Smokeball OAuth client ID |
| `SMOKEBALL_CLIENT_SECRET` | Client’s secret |
| `SMOKEBALL_API_KEY` | Client’s API key |
| `SMOKEBALL_AUTH_URL` | Staging or production auth host |
| `SMOKEBALL_API_URL` | Staging or production API host |
| `SMOKEBALL_REDIRECT_URI` | `https://<this-deployment>/auth/callback` |
| `SMOKEBALL_OAUTH_MODE` | `proxy` |
| `PUBLIC_URL` | `https://<this-deployment>` |

Redeploy after changing environment variables.

### 3. 3CX CRM template

Edit `3cx_smokeball_template_fixed.xml` before loading into the PBX:

| XML field | Change to |
|-----------|-----------|
| `Name` | Display name in 3CX (e.g. `Smokeball - Acme Law`) |
| `MiddlewareServerUrl` default | `https://<middleware-host>` (no trailing slash) |
| `ClientId` default | Client’s Smokeball client ID (optional; can be entered in UI) |

In **3CX Admin → Integrations → CRM**:

1. Click **Add Template** and upload the XML file.
2. Select the template from the dropdown.
3. Fill in:
   - **Middleware Server URL** — your deployed middleware base URL
   - **API Key** — Smokeball API key
   - **Client ID** / **Client Secret** — Smokeball OAuth credentials
4. Click **Save**, then **Authorize**.
5. Complete Smokeball login; you should be redirected back to 3CX with a refresh token populated.
6. Set **Query CRM** to “Always query” (or as required).
7. Optionally enable **Call Journaling**.

### 4. Verify

- [ ] Dashboard at `https://<middleware-host>/` shows server online.
- [ ] **Authorize** completes without `redirect_mismatch`.
- [ ] Server logs show: `OAuth authorize (proxy): 3CX redirect=https://<pbx>/api/oauth2crm -> Smokeball redirect=https://<middleware>/auth/callback`
- [ ] Place a test call from a number that exists in Smokeball; caller name should appear on the 3CX client.

### 5. What does **not** need to change per client

- Application source code (unless adding features).
- OAuth flow logic — only env vars and XML defaults change.
- The 3CX callback path is always `/api/oauth2crm` (generated by 3CX automatically).

### 6. What **must** match exactly

| Item | Must match |
|------|------------|
| `SMOKEBALL_REDIRECT_URI` | Registered in Smokeball developer portal |
| Token exchange `redirect_uri` | Same as authorize (handled automatically in proxy mode) |
| `SMOKEBALL_API_URL` | Same environment as the firm’s Smokeball account (staging vs prod) |
| Middleware URL in 3CX | Deployed and reachable from the PBX and user browsers |

---

## Local development

```bash
cp .env.example .env
# Edit .env with your credentials

npm install
npm start
```

Open `http://localhost:3000` for the dashboard.

For OAuth testing locally, use a tunnel (e.g. ngrok) and set `SMOKEBALL_REDIRECT_URI` to `https://<tunnel>/auth/callback`, then register that URL in Smokeball.

---

## Troubleshooting

### `redirect_mismatch` from Smokeball

- Confirm `SMOKEBALL_OAUTH_MODE=proxy` on the deployment.
- Confirm `SMOKEBALL_REDIRECT_URI` matches **exactly** what is registered in Smokeball (including `https`, no trailing slash on the base path, `/auth/callback` path included).
- Check middleware logs after clicking Authorize — the “Smokeball redirect=” value must match the registered URI.

### Authorize works but token exchange fails

- Ensure proxy mode rewrites `redirect_uri` on the token endpoint (default behavior).
- Confirm Client ID and Client Secret in 3CX match the Smokeball app.

### "Unauthorized" when answering a call / opening contact

3CX opens the `ContactUrl` from lookup in your browser. If that URL points at the **REST API** (`stagingapi.smokeball.com.au/contacts/...`), the browser has no OAuth token and Smokeball returns `{"message":"Unauthorized"}`.

The middleware now returns the **Smokeball web app** URL instead (`SMOKEBALL_APP_URL`, default `https://app.smokeball.com.au/contacts/{id}`). Set `SMOKEBALL_APP_URL` in Vercel if your firm uses a different host.

### Lookup returns no contacts

- Confirm the refresh token / access token is valid (re-authorize).
- Verify `SMOKEBALL_API_KEY` is set on the deployment.
- The phone number must exist on a Smokeball contact; matching uses Smokeball `Search` then suffix verification locally.
- Check middleware logs for `Smokeball phone search: phone:*...` entries.

### 429 rate limit errors

- Default limit is 5 requests/second per Smokeball client ID.
- The middleware retries automatically with exponential backoff.
- If errors persist under heavy call volume, contact Smokeball about rate limit increases or deploy per-client middleware instances.

### 3CX cannot reach middleware

- Middleware must be HTTPS and publicly reachable.
- Check firewall / 3CX outbound access to your Vercel host.

---

## Repository

- **GitHub:** https://github.com/LentilKun/Smokeball3cxITT
- **Default deployment:** Vercel (`vercel.json` routes all traffic to `server.js`)
