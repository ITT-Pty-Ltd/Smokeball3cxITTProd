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

const redirectUri =
    process.env.SMOKEBALL_REDIRECT_URI || 'https://smokeball3cx-itt.vercel.app/auth/callback';

const config = {
    port: Number(process.env.PORT) || 3000,
    publicUrl:
        process.env.PUBLIC_URL ||
        redirectUri.replace(/\/auth\/callback\/?$/, '') ||
        'http://localhost:3000',
    smokeball: {
        clientId: process.env.SMOKEBALL_CLIENT_ID,
        clientSecret: process.env.SMOKEBALL_CLIENT_SECRET,
        apiKey: process.env.SMOKEBALL_API_KEY,
        apiUrl: process.env.SMOKEBALL_API_URL || 'https://stagingapi.smokeball.com.au',
        authBaseUrl: normalizeAuthBaseUrl(process.env.SMOKEBALL_AUTH_URL),
        redirectUri,
    },
};

function validateConfig() {
    const missing = [];
    if (!config.smokeball.clientId) missing.push('SMOKEBALL_CLIENT_ID');
    if (!config.smokeball.clientSecret) missing.push('SMOKEBALL_CLIENT_SECRET');
    if (!config.smokeball.apiKey) missing.push('SMOKEBALL_API_KEY');
    if (missing.length) {
        console.warn(`Warning: missing env vars: ${missing.join(', ')}`);
    }
}

validateConfig();

module.exports = config;
