/** Normalise SMOKEBALL_AUTH_URL to the OAuth host root (handles legacy full authorize URLs). */
function normalizeAuthBaseUrl(raw) {
    const fallback = 'https://datastaging-auth.smokeball.com.au';
    if (!raw) return fallback;

    try {
        const url = new URL(raw);
        return `${url.protocol}//${url.host}`;
    } catch {
        return raw.replace(/\/oauth2\/authorize.*$/i, '').replace(/\/$/, '') || fallback;
    }
}

const redirectUri = process.env.SMOKEBALL_REDIRECT_URI;

/** Web app origin only — no paths or {placeholders} (3CX may append /contacts/{id} itself). */
function deriveAppUrl(apiUrl) {
    const raw = process.env.SMOKEBALL_APP_URL;
    if (raw) {
        try {
            const url = new URL(raw);
            return `${url.protocol}//${url.host}`;
        } catch {
            return raw.replace(/\/$/, '').replace(/\/contacts.*$/i, '');
        }
    }
    try {
        const host = new URL(apiUrl).hostname;
        if (host.includes('smokeball.co.uk')) return 'https://app.smokeball.co.uk';
        if (host.includes('smokeball.com') || host.includes('smokeball.com.au')) {
            return 'https://app.smokeball.com.au';
        }
    } catch {
        // fall through
    }
    return 'https://app.smokeball.com.au';
}

/** passthrough = forward 3CX redirect_uri. proxy = rewrite to SMOKEBALL_REDIRECT_URI (default). */
const oauthMode = (process.env.SMOKEBALL_OAUTH_MODE || 'proxy').toLowerCase();

const config = {
    port: Number(process.env.PORT) || 3000,
    publicUrl:
        process.env.PUBLIC_URL ||
        (redirectUri ? redirectUri.replace(/\/auth\/callback\/?$/, '') : null) ||
        'http://localhost:3000',
    smokeball: {
        clientId: process.env.SMOKEBALL_CLIENT_ID,
        clientSecret: process.env.SMOKEBALL_CLIENT_SECRET,
        apiKey: process.env.SMOKEBALL_API_KEY,
        apiUrl: process.env.SMOKEBALL_API_URL || 'https://stagingapi.smokeball.com.au',
        appUrl: deriveAppUrl(process.env.SMOKEBALL_API_URL || 'https://stagingapi.smokeball.com.au'),
        authBaseUrl: normalizeAuthBaseUrl(process.env.SMOKEBALL_AUTH_URL),
        redirectUri,
        oauthMode: oauthMode === 'proxy' ? 'proxy' : 'passthrough',
        maxRetries: Number(process.env.SMOKEBALL_MAX_RETRIES) || 3,
        retryBaseDelayMs: Number(process.env.SMOKEBALL_RETRY_BASE_DELAY_MS) || 500,
        searchResultLimit: Number(process.env.SMOKEBALL_SEARCH_LIMIT) || 50,
        defaultStaffId: process.env.SMOKEBALL_DEFAULT_STAFF_ID || null,
        timeActivityCode: process.env.SMOKEBALL_TIME_ACTIVITY_CODE || null,
    },
    journal: {
        /** Create Smokeball tasks from call/chat journals (3CX Enable Call/Chat Journaling still required). */
        createTasks: process.env.JOURNAL_CREATE_TASKS !== 'false',
        /** Skip journaling when no CRM contact was matched (filters solicitor-shopping / telemarketers). */
        requireContact: process.env.JOURNAL_REQUIRE_CONTACT === 'true',
        /** Skip task creation when no matter can be resolved for the contact. */
        requireMatter: process.env.JOURNAL_REQUIRE_MATTER === 'true',
        /** Create a time fee on the matter when a matter is resolved. */
        createTimeEntries: process.env.JOURNAL_CREATE_TIME_ENTRIES !== 'false',
        /** Skip missed / unanswered outbound call types. */
        skipMissed: process.env.JOURNAL_SKIP_MISSED === 'true',
    },
};

function validateConfig() {
    const missing = [];
    if (!config.smokeball.clientId) missing.push('SMOKEBALL_CLIENT_ID');
    if (!config.smokeball.clientSecret) missing.push('SMOKEBALL_CLIENT_SECRET');
    if (!config.smokeball.apiKey) missing.push('SMOKEBALL_API_KEY');
    if (!redirectUri) missing.push('SMOKEBALL_REDIRECT_URI');
    if (missing.length) {
        console.warn(`Warning: missing env vars: ${missing.join(', ')}`);
    }
}

validateConfig();

module.exports = config;
