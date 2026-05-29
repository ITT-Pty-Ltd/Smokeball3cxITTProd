const axios = require('axios');
const config = require('../config');
const { requestWithRetry } = require('../utils/httpRetry');
const { logger } = require('../logger');

const { maxRetries, retryBaseDelayMs, searchResultLimit } = config.smokeball;

function getDigitsFromPhoneObj(phoneObj) {
    if (!phoneObj) return '';
    return `${phoneObj.areaCode || ''}${phoneObj.number || ''}`.replace(/\D/g, '');
}

function phoneMatches(normalisedInput, contact) {
    if (!normalisedInput) return false;

    const suffixMatch = (digits) =>
        digits && (digits.endsWith(normalisedInput) || normalisedInput.endsWith(digits));

    if (contact.person) {
        for (const ph of [contact.person.phone, contact.person.phone2, contact.person.cell]) {
            if (suffixMatch(getDigitsFromPhoneObj(ph))) return true;
        }
    }

    if (contact.company?.phone && suffixMatch(getDigitsFromPhoneObj(contact.company.phone))) {
        return true;
    }

    return false;
}

/** Build Smokeball Search terms (phone:*value*) for progressive lookup attempts. */
function buildPhoneSearchTerms(phoneNumber) {
    const digits = phoneNumber.replace(/\D/g, '');
    const candidates = [];

    const addDigits = (d) => {
        if (d && d.length >= 4) candidates.push(d);
    };

    addDigits(digits);
    if (digits.length >= 8) addDigits(digits.slice(-8));
    if (digits.length >= 6) addDigits(digits.slice(-6));

    if (digits.startsWith('61') && digits.length > 10) {
        const local = digits.slice(2);
        addDigits(local);
        if (local.length >= 8) addDigits(local.slice(-8));
    }

    if (digits.startsWith('0') && digits.length > 1) {
        const local = digits.slice(1);
        addDigits(local);
        if (local.length >= 8) addDigits(local.slice(-8));
    }

    return [...new Set(candidates.map((d) => `phone:*${d}*`))];
}

/** Prefer the contact Smokeball updated most recently when several share a phone number. */
function pickBestContactMatch(matches) {
    if (!matches.length) return null;

    const byId = new Map();
    for (const contact of matches) {
        byId.set(contact.id, contact);
    }

    const unique = [...byId.values()];
    unique.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    return unique[0];
}

class SmokeballService {
    constructor() {
        this.apiKey = config.smokeball.apiKey;
        this.apiUrl = config.smokeball.apiUrl;
        this.appUrl = config.smokeball.appUrl;
    }

    /**
     * URL opened by 3CX in the browser when answering a call.
     * Uses middleware contact page — Smokeball has no public per-contact web URL.
     */
    buildContactOpenUrl(contactId) {
        return `${config.publicUrl}/api/3cx/contacts/${contactId}/open`;
    }

    _headers(accessToken) {
        if (!accessToken) {
            throw new Error('Access token is required for Smokeball API calls');
        }
        if (!this.apiKey) {
            throw new Error('SMOKEBALL_API_KEY is not configured');
        }
        return {
            Authorization: `Bearer ${accessToken}`,
            'x-api-key': this.apiKey,
        };
    }

    _buildContactsUrl(queryParams) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(queryParams)) {
            if (value == null) continue;
            if (Array.isArray(value)) {
                for (const item of value) {
                    params.append(key, item);
                }
            } else {
                params.append(key, String(value));
            }
        }
        return `${this.apiUrl}/contacts/?${params.toString()}`;
    }

    async _get(accessToken, url) {
        return requestWithRetry(
            async () => {
                const response = await axios.get(url, { headers: this._headers(accessToken) });
                return response.data;
            },
            { maxRetries, baseDelayMs: retryBaseDelayMs }
        );
    }

    /** Fetch contacts (paginated). */
    async fetchContacts(accessToken, offset = 0, limit = 500) {
        const url = this._buildContactsUrl({ Offset: offset, Limit: limit });
        return this._get(accessToken, url);
    }

    /** Fetch contacts using Smokeball Search API. */
    async searchContacts(accessToken, searchTerms, offset = 0, limit = searchResultLimit) {
        const url = this._buildContactsUrl({
            Search: searchTerms,
            Offset: offset,
            Limit: limit,
        });
        return this._get(accessToken, url);
    }

    /** Fetch a single contact by ID. */
    async fetchContactById(accessToken, contactId) {
        const url = `${this.apiUrl}/contacts/${contactId}`;
        return this._get(accessToken, url);
    }

    /**
     * Search contacts by phone number using Smokeball's Search parameter,
     * collect all matches, then return the most recently updated contact.
     * Re-fetches by ID so 3CX always gets current name/details from Smokeball.
     */
    async searchContactByPhone(accessToken, phoneNumber) {
        const normalised = phoneNumber.replace(/\D/g, '');
        const searchTerms = buildPhoneSearchTerms(phoneNumber);
        const matches = [];

        for (const term of searchTerms) {
            logger.info(`Smokeball phone search: ${term}`);
            const page = await this.searchContacts(accessToken, [term]);
            const contacts = page.value || [];

            for (const contact of contacts) {
                if (phoneMatches(normalised, contact)) {
                    matches.push(contact);
                }
            }

            if (matches.length) break;
        }

        const best = pickBestContactMatch(matches);
        if (!best) return null;

        if (matches.length > 1) {
            logger.info(
                `Multiple Smokeball contacts matched phone ${phoneNumber}; using id=${best.id} (lastUpdated=${best.lastUpdated})`
            );
        }

        try {
            return await this.fetchContactById(accessToken, best.id);
        } catch (err) {
            logger.warn(`Could not refresh contact ${best.id}, using search result:`, err.message);
            return best;
        }
    }
}

module.exports = new SmokeballService();
