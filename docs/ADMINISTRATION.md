# Smokeball and 3CX Integration: Administration Guide

This guide is for **IT administrators**, **3CX administrators**, and **Smokeball application owners** who deploy and operate the integration. It covers setup, day-to-day operation, and troubleshooting. Technical design detail is in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Roles and responsibilities

| Role | Typical tasks |
|------|----------------|
| Smokeball app owner | Create OAuth app, register redirect URI, assign API key and scopes, approve firm use |
| Azure / hosting admin | Deploy middleware, set Application Settings, monitor uptime, renew certificates |
| 3CX admin | Upload CRM template, authorize integration, enable journaling and transcription, configure extensions |
| Practice manager | Decide journaling rules (matched contacts only, matters required, time costing) |

---

## 2. Prerequisites

### 2.1 Smokeball

- Firm account on the correct environment (**staging** vs **production** URLs must match everywhere).
- Developer portal application with:
  - **Redirect URI (proxy mode):** `https://<middleware-host>/auth/callback`
  - **Client ID**, **Client secret**, **API key**
- OAuth scopes (minimum for full features):
  - `contacts/read`
  - `staff/read`
  - `matters/read`
  - `tasks/write`
  - `fees/write` (if auto time costing is enabled)

### 2.2 3CX

- **V20** recommended (CRM XML integration, AI transcription for journaling).
- Public HTTPS FQDN for the PBX (for example `https://yourfirm.3cx.com.au`).
- CRM integration enabled under **Admin → Integrations → CRM**.
- For transcripts in Smokeball tasks:
  - **Integrations → Transcription:** **3CX Transcription Service (Cloud)** (or supported on-prem AI server).
  - Call **recording** on relevant extensions.
  - Transcription enabled on **department** and **queue / ring group** as well as the extension.
  - CRM **Parameter Values** must include `[Summary]` and `[Transcription]` in call journaling text (see section 5).

### 2.3 Middleware hosting

- Public **HTTPS** URL reachable from the PBX and from user browsers (Azure App Service or equivalent).
- Node.js 20 runtime, always on (not serverless cold start for OAuth redirects).

---

## 3. Initial deployment checklist

### 3.1 Deploy the middleware

1. Create Azure Web App (Linux, Node 20) or use existing ITT deployment.
2. Set **Application settings** (see section 4). At minimum: all `SMOKEBALL_*` variables, `SMOKEBALL_REDIRECT_URI`, `PUBLIC_URL`, `SMOKEBALL_OAUTH_MODE=proxy`.
3. Deploy code (GitHub Actions push to `master` / `main`, or manual deploy).
4. Confirm `https://<host>/api/status` returns `"status":"ok"`.
5. Keep the Web App **Running** (stopped app returns 403 to 3CX).

### 3.2 Smokeball developer portal

1. Register redirect URI exactly: `https://<host>/auth/callback` (no trailing slash on host).
2. Copy credentials into Azure settings and (optionally) into 3CX CRM parameter fields.
3. Publish or approve the app per Smokeball process.

### 3.3 3CX CRM template

1. Edit `3cx_smokeball_template_fixed.xml` defaults if needed:
   - `Name` (display name in 3CX)
   - `MiddlewareServerUrl` default to your host (no trailing slash)
2. **Admin → Integrations → CRM → Add template** and upload the XML (**Version 7** or current repo version).
3. Select the template and open **Parameter values**:
   - **Middleware Server URL**
   - **API Key**, **Client ID**, **Client Secret**
4. Click **Save**, then **Authorize** and complete Smokeball login.
5. Confirm **Refresh Token** is populated.
6. Set **Query CRM** to **Always query** (or per firm policy).
7. Enable **Enable Call Journaling** / **Enable Chat Journaling** as required.

### 3.4 3CX client behavior

- Enable **open CRM contact on answer** (desktop) if contact pop is required.
- Optional: **Add CRM contacts to company phonebook** (may create duplicates; see troubleshooting).
- Ensure each extension has **first name**, **last name**, and **email** matching Smokeball staff for task assignment.

### 3.5 Verification

| Test | Expected result |
|------|-----------------|
| Authorize CRM | Redirect back to 3CX without `redirect_mismatch` |
| Inbound call from known Smokeball number | Caller name on 3CX client |
| `/api/logs` after call | `Match found: ...` |
| End call with journaling on | Smokeball task created; logs show `Smokeball task created` |
| Transcription enabled on PBX | Logs show `Journal AI fields: transcript=...` with length greater than 0 |

---

## 4. Environment variables (middleware)

Set in Azure **Configuration → Application settings** (or `.env` locally). Restart after changes.

### 4.1 Required

| Variable | Example | Notes |
|----------|---------|--------|
| `SMOKEBALL_CLIENT_ID` | From portal | |
| `SMOKEBALL_CLIENT_SECRET` | From portal | |
| `SMOKEBALL_API_KEY` | From portal | Sent as `x-api-key` |
| `SMOKEBALL_AUTH_URL` | `https://datastaging-auth.smokeball.com.au` | Host only, no `/oauth2/authorize` path |
| `SMOKEBALL_API_URL` | `https://stagingapi.smokeball.com.au` | Production: `https://api.smokeball.com.au` |
| `SMOKEBALL_REDIRECT_URI` | `https://<host>/auth/callback` | Must match Smokeball registration |
| `PUBLIC_URL` | `https://<host>` | Used in logs and contact links |

### 4.2 OAuth

| Variable | Default | Notes |
|----------|---------|--------|
| `SMOKEBALL_OAUTH_MODE` | `proxy` | Use `passthrough` only if PBX URL is registered in Smokeball |

### 4.3 Journaling behavior

| Variable | Default | When to change |
|----------|---------|----------------|
| `JOURNAL_CREATE_TASKS` | `true` | `false` to accept journals but not create tasks |
| `JOURNAL_REQUIRE_CONTACT` | `false` in code default; often `true` in production | `true` skips unmatched numbers |
| `JOURNAL_REQUIRE_MATTER` | `false` | `true` only creates tasks when an open/pending matter exists |
| `JOURNAL_CREATE_TIME_ENTRIES` | `true` | `false` to disable auto time fees |
| `JOURNAL_SKIP_MISSED` | `false` | `true` to skip missed / unanswered types |
| `SMOKEBALL_DEFAULT_STAFF_ID` | empty | **Strongly recommended:** Smokeball staff GUID fallback |
| `SMOKEBALL_TIME_ACTIVITY_CODE` | empty | Optional fee activity code |

### 4.4 Resilience

| Variable | Default |
|----------|---------|
| `SMOKEBALL_MAX_RETRIES` | `3` |
| `SMOKEBALL_RETRY_BASE_DELAY_MS` | `500` |
| `SMOKEBALL_SEARCH_LIMIT` | `50` |

---

## 5. 3CX CRM parameter values (journaling text)

Re-uploading the XML file **does not** always update existing **Parameter values**. After each template upgrade, manually confirm **Answered Inbound Call** (and outbound / missed variants) contain:

```
Summary: [Summary]
Transcription: [Transcription]
Recording: [RecordingUrl]
```

Use `[LineBreak]` between sections as in the template defaults.

After changes, **restart the 3CX System Service**.

---

## 6. Transcription and AI summaries in Smokeball tasks

Transcription appears in Smokeball task **Details** (API `note`) only when **3CX sends** `Transcription` and/or `Summary` in the journal POST.

**Admin checklist**

1. Transcription provider: **3CX Transcription Service (Cloud)** (typical for CRM journaling).
2. Recording + transcription on extension, department, and queue.
3. CRM journaling text includes `[Transcription]` and `[Summary]`.
4. Test call (30+ seconds of speech); confirm transcript on the **recording in 3CX web client** first.
5. Check middleware logs: `Journal AI fields: summary=N, transcript=M`. If both are 0, fix 3CX before expecting Smokeball content.

The middleware cannot generate transcripts; it only formats and stores what 3CX provides.

---

## 7. Operational monitoring

| Resource | URL / action |
|----------|----------------|
| Health | `GET https://<host>/api/status` |
| Recent CRM logs | `GET https://<host>/api/logs` or dashboard `/` |
| Azure | App Service metrics, deployment logs, **always On** |
| Smokeball | Task list for test calls |
| 3CX | CRM integration status, System Service logs if journaling fails |

**Log messages to watch**

- `OAuth authorize (proxy)` on successful authorize setup
- `Match found:` on lookup success
- `Call journal skipped: contact_required` when `JOURNAL_REQUIRE_CONTACT=true` and no contact
- `Journal received no AI summary or transcription` when 3CX sent empty AI fields
- `Token proxy error` on OAuth refresh issues (re-authorize CRM)

---

## 8. Upgrades and template versions

1. Deploy new middleware from GitHub (or approved release).
2. Upload new `3cx_smokeball_template_fixed.xml` to 3CX (note **Version** in XML root).
3. Re-check **Parameter values** (especially journaling text and middleware URL).
4. Re-**Authorize** if OAuth client or redirect URI changed.
5. Place test call and review `/api/logs`.

---

## 9. Troubleshooting

### OAuth `redirect_mismatch`

- `SMOKEBALL_OAUTH_MODE` must be `proxy` unless using passthrough with PBX URL registered in Smokeball.
- `SMOKEBALL_REDIRECT_URI` must match the Smokeball portal **character for character**.

### Caller ID not showing

- Re-import current XML (PhoneMobile must map to dialled number).
- Confirm lookup in `/api/logs` (`Match found` vs `No Smokeball contact`).
- AU numbers: middleware normalizes `+61` vs `0` prefixes.

### Tasks not created

- Azure app **Running**.
- `JOURNAL_CREATE_TASKS=true`.
- `JOURNAL_REQUIRE_CONTACT=true` requires matched contact (or phone cache from prior lookup).
- `staff_not_found`: set `SMOKEBALL_DEFAULT_STAFF_ID` or fix extension email in 3CX / Smokeball staff.

### Duplicate contacts in 3CX

- Disable **Add CRM contacts to phonebook** or clean duplicates manually.
- Middleware returns stable `EntityId` (most recently updated Smokeball contact per number).

### Contact URL "Unauthorized" in browser

- Expected if template points at Smokeball API URLs. Use middleware URL: `/api/3cx/contacts/{id}/open` (current template).

### Rate limiting (429)

- Middleware retries automatically; reduce parallel CRM load or request higher limits from Smokeball.

### 3CX cannot reach middleware

- Confirm HTTPS, firewall, and DNS from PBX to middleware host.

### Multiple journal POSTs per call

- Normal for transfers, queues, or multi-node PBX. Only journals with a resolved contact create tasks when `JOURNAL_REQUIRE_CONTACT=true`.

---

## 10. Security and compliance

- Do not commit `.env` or publish API keys.
- Rotate Smokeball client secret if exposed; re-authorize 3CX CRM.
- Restrict who can access `/api/logs` (no built-in auth).
- Call recordings and transcripts are subject to firm privacy policy; middleware does not retain recordings.

---

## 11. Support escalation

When opening a ticket, include:

1. Timestamp of test call (UTC).
2. Excerpt from `https://<host>/api/logs` (journal keys, `Journal AI fields`, skip reason).
3. 3CX version and whether transcript appears on the recording in 3CX UI.
4. Whether issue is staging or production Smokeball.

---

## 12. Related documents

- [ARCHITECTURE.md](./ARCHITECTURE.md): technical design and data flows
- [README.md](../README.md): API reference and local development
