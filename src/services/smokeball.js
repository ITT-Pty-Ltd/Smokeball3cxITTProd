const axios = require('axios');
const winston = require('winston');
const { createClient } = require('@supabase/supabase-js');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
});

class SmokeballService {
    constructor() {
        this.clientId = process.env.SMOKEBALL_CLIENT_ID;
        this.clientSecret = process.env.SMOKEBALL_CLIENT_SECRET;
        this.apiKey = process.env.SMOKEBALL_API_KEY;
        this.apiUrl = process.env.SMOKEBALL_API_URL || 'https://stagingapi.smokeball.com.au';
        this.authUrl = process.env.SMOKEBALL_AUTH_URL || 'https://datastaging-auth.smokeball.com.au';
        this.redirectUri = process.env.SMOKEBALL_REDIRECT_URI || 'https://smokeball3cx-itt.vercel.app/';

        const supaUrl = process.env.SUPABASE_URL || '';
        const supaKey = process.env.SUPABASE_KEY || '';
        this.supabase = supaUrl && supaKey ? createClient(supaUrl, supaKey) : null;
        
        if (!this.supabase) {
            logger.warn('!!! WARNING: SUPABASE_URL or SUPABASE_KEY is missing from the environment! Database persistence is disabled and tokens will be wiped. !!!');
        }

        // In-memory cache
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
    }

    async loadTokensFromDb() {
        if (!this.supabase) return false;
        try {
            const { data, error } = await this.supabase
                .from('smokeball_auth')
                .select('access_token, refresh_token, token_expiry')
                .eq('id', 1)
                .single();
            if (error) {
                logger.error(`Supabase DB read error: ${error.message}`);
            } else if (data) {
                this.accessToken = data.access_token;
                this.refreshToken = data.refresh_token;
                this.tokenExpiry = data.token_expiry;
                return true;
            }
        } catch (err) {
            logger.error(`Failed to execute DB load: ${err.message}`);
        }
        return false;
    }

    async saveTokensToDb(access, refresh, expiry) {
        this.accessToken = access;
        this.refreshToken = refresh;
        this.tokenExpiry = expiry;

        if (!this.supabase) return;
        try {
            const { error } = await this.supabase.from('smokeball_auth').upsert({
                id: 1,
                access_token: access,
                refresh_token: refresh,
                token_expiry: expiry
            });
            if (error) {
                logger.error(`Supabase DB write error: ${error.message} - Please check Row Level Security (RLS) policies on your table!`);
            }
        } catch (err) {
            logger.error(`Failed to execute DB save: ${err.message}`);
        }
    }

    // ---------------------------------------------------------------------------
    // OAuth2 helpers
    // ---------------------------------------------------------------------------

    /** Build the URL users visit to authorize the app (Authorization Code Grant). */
    getInstallUrl() {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
        });
        return `${this.authUrl}/oauth2/authorize?${params.toString()}`;
    }

    /** Exchange an authorization code for access + refresh tokens. */
    async exchangeCodeForTokens(code) {
        const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            code,
        });

        logger.info('Exchanging authorization code for tokens…');

        const response = await axios.post(`${this.authUrl}/oauth2/token`, body.toString(), {
            headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const expiry = Date.now() + response.data.expires_in * 1000 - 60_000; // 1-min buffer
        await this.saveTokensToDb(response.data.access_token, response.data.refresh_token, expiry);

        logger.info('Tokens acquired successfully and saved to DB.');
        return response.data;
    }

    /** Refresh the access token using the stored refresh token. */
    async refreshAccessToken() {
        // We might be spinning up from a cold start
        if (!this.refreshToken) {
            await this.loadTokensFromDb();
        }

        if (!this.refreshToken) {
            throw new Error('No refresh token available – user must re-authorize.');
        }

        const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.clientId,
            refresh_token: this.refreshToken,
        });

        logger.info('Refreshing access token…');

        const response = await axios.post(`${this.authUrl}/oauth2/token`, body.toString(), {
            headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const expiry = Date.now() + response.data.expires_in * 1000 - 60_000;
        await this.saveTokensToDb(response.data.access_token, response.data.refresh_token, expiry);

        logger.info('Access token refreshed and saved to DB.');
        return response.data;
    }

    /** Return a valid access token, refreshing if needed. */
    async getAccessToken() {
        if (!this.accessToken) {
            await this.loadTokensFromDb();
        }

        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        // Even if we have a refresh token but access token expired, refreshAccessToken will reload from DB if needed
        if (this.refreshToken || await this.loadTokensFromDb()) {
            if (this.refreshToken) {
                await this.refreshAccessToken();
                return this.accessToken;
            }
        }

        throw new Error('Not authenticated – visit /auth/install to connect your Smokeball account.');
    }

    // ---------------------------------------------------------------------------
    // API helpers
    // ---------------------------------------------------------------------------

    /** Return standard headers for every Smokeball API call. */
    async _headers() {
        const token = await this.getAccessToken();
        return {
            Authorization: `Bearer ${token}`,
            'x-api-key': this.apiKey,
        };
    }

    // ---------------------------------------------------------------------------
    // Contacts
    // ---------------------------------------------------------------------------

    /** Fetch all contacts (paginated). */
    async fetchContacts(offset = 0, limit = 500) {
        const headers = await this._headers();
        const response = await axios.get(`${this.apiUrl}/contacts/`, {
            headers,
            params: { offset, limit },
        });
        return response.data;
    }

    /** Fetch a single contact by ID. */
    async fetchContactById(contactId) {
        const headers = await this._headers();
        const response = await axios.get(`${this.apiUrl}/contacts/${contactId}`, { headers });
        return response.data;
    }

    /**
     * Search contacts by phone number.
     * The Smokeball API does not expose a native phone-search endpoint, so we
     * iterate through paginated contacts and match locally. For large contact
     * lists, consider caching contacts in a local database.
     */
    async searchContactByPhone(phoneNumber) {
        const normalised = phoneNumber.replace(/\D/g, ''); // digits only
        let offset = 0;
        const limit = 500;

        // Helper: extract digits from a Smokeball phone object {areaCode, number}
        const getDigits = (phoneObj) => {
            if (!phoneObj) return '';
            const raw = `${phoneObj.areaCode || ''}${phoneObj.number || ''}`;
            return raw.replace(/\D/g, '');
        };

        // Helper: compare two digit strings flexibly
        const phoneMatch = (digits) => {
            if (!digits) return false;
            return digits.endsWith(normalised) || normalised.endsWith(digits);
        };

        while (true) {
            const page = await this.fetchContacts(offset, limit);
            const contacts = page.value || [];

            for (const contact of contacts) {
                // Check person contacts
                if (contact.person) {
                    const phoneFields = [
                        contact.person.phone,
                        contact.person.phone2,
                        contact.person.cell,
                    ];
                    for (const ph of phoneFields) {
                        if (phoneMatch(getDigits(ph))) {
                            return contact;
                        }
                    }
                }

                // Check company contacts
                if (contact.company && contact.company.phone) {
                    if (phoneMatch(getDigits(contact.company.phone))) {
                        return contact;
                    }
                }
            }

            if (contacts.length < limit) break; // last page
            offset += limit;
        }

        return null; // not found
    }

    // ---------------------------------------------------------------------------
    // Status helper
    // ---------------------------------------------------------------------------

    async isAuthenticated() {
        if (!this.accessToken) {
            await this.loadTokensFromDb();
        }
        return !!(this.accessToken || this.refreshToken);
    }
}

module.exports = new SmokeballService();
