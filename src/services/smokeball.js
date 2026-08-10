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

    async _post(accessToken, url, data, extraHeaders = {}) {
        return requestWithRetry(
            async () => {
                const response = await axios.post(url, data, {
                    headers: { ...this._headers(accessToken), ...extraHeaders },
                });
                return response.data;
            },
            { maxRetries, baseDelayMs: retryBaseDelayMs }
        );
    }

    _buildStaffUrl(queryParams) {
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
        return `${this.apiUrl}/staff?${params.toString()}`;
    }

    /** Search firm staff (Search fields: email, name). */
    async searchStaff(accessToken, searchTerms, offset = 0, limit = 25) {
        const url = this._buildStaffUrl({
            Search: searchTerms,
            Offset: offset,
            Limit: limit,
        });
        return this._get(accessToken, url);
    }

    /** List firm staff (paginated). Used when Search fails or returns no match. */
    async listStaff(accessToken, offset = 0, limit = 500) {
        const url = this._buildStaffUrl({ Offset: offset, Limit: limit });
        return this._get(accessToken, url);
    }

    /** Create a task (matterId optional). Returns link object (HTTP 202). */
    async createTask(accessToken, task, options = {}) {
        const url = `${this.apiUrl}/tasks`;
        const headers = {};
        if (options.requestId) {
            headers.RequestId = options.requestId;
        }
        if (options.userId) {
            headers.UserId = options.userId;
        }
        return this._post(accessToken, url, task, headers);
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

    _buildMattersUrl(queryParams) {
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
        return `${this.apiUrl}/matters?${params.toString()}`;
    }

    /** List matters (ContactId / Status filters supported). */
    async listMatters(accessToken, { contactId, status, offset = 0, limit = 50 } = {}) {
        const query = { Offset: offset, Limit: limit };
        if (contactId) query.ContactId = contactId;
        if (status) query.Status = Array.isArray(status) ? status : [status];
        return this._get(accessToken, this._buildMattersUrl(query));
    }

    /** Create a time/fixed fee on a matter (HTTP 202 Link). */
    async createFee(accessToken, matterId, fee, options = {}) {
        const url = `${this.apiUrl}/matters/${matterId}/fees`;
        const headers = {};
        if (options.requestId) headers.RequestId = options.requestId;
        if (options.userId) headers.UserId = options.userId;
        return this._post(accessToken, url, fee, headers);
    }

    async _refreshContact(accessToken, contact) {
        if (!contact?.id) return contact;
        try {
            return await this.fetchContactById(accessToken, contact.id);
        } catch (err) {
            logger.warn(`Could not refresh contact ${contact.id}, using search result:`, err.message);
            return contact;
        }
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

        return this._refreshContact(accessToken, best);
    }

    /** Lookup a single contact by email (exact then wildcard). */
    async searchContactByEmail(accessToken, email) {
        const normalised = (email || '').trim().toLowerCase();
        if (!normalised || !normalised.includes('@')) return null;

        const attempts = [`email:${normalised}`, `email:*${normalised}*`];
        for (const term of attempts) {
            logger.info(`Smokeball email search: ${term}`);
            const page = await this.searchContacts(accessToken, [term]);
            const contacts = (page.value || []).filter((c) => {
                const personEmail = (c.person?.email || '').toLowerCase();
                const companyEmail = (c.company?.email || '').toLowerCase();
                return personEmail === normalised || companyEmail === normalised;
            });
            const best = pickBestContactMatch(contacts.length ? contacts : page.value || []);
            if (best) return this._refreshContact(accessToken, best);
        }
        return null;
    }

    /**
     * Free-text search for 3CX SearchContacts (name, phone, or email).
     * Returns up to `limit` contacts, most recently updated first.
     */
    async searchContactsByText(accessToken, searchText, limit = 10) {
        const q = (searchText || '').trim();
        if (!q) return [];

        const digits = q.replace(/\D/g, '');
        const looksLikeEmail = q.includes('@');
        const looksLikePhone = digits.length >= 4 && digits.length >= q.replace(/\s+/g, '').length * 0.6;

        const termSets = [];
        if (looksLikeEmail) {
            termSets.push([`email:*${q}*`]);
        } else if (looksLikePhone) {
            for (const term of buildPhoneSearchTerms(q)) {
                termSets.push([term]);
            }
        } else {
            termSets.push([`name:*${q}*`]);
            // Also try email/phone when the query is ambiguous
            termSets.push([`email:*${q}*`]);
            if (digits.length >= 4) {
                termSets.push([`phone:*${digits}*`]);
            }
        }

        const byId = new Map();
        for (const terms of termSets) {
            logger.info(`Smokeball text search: ${terms.join(', ')}`);
            const page = await this.searchContacts(accessToken, terms, 0, Math.max(limit, 25));
            for (const contact of page.value || []) {
                if (contact?.id && !byId.has(contact.id)) {
                    byId.set(contact.id, contact);
                }
            }
            if (byId.size >= limit) break;
        }

        const ranked = [...byId.values()].sort(
            (a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0)
        );
        return ranked.slice(0, limit);
    }
}

module.exports = new SmokeballService();
