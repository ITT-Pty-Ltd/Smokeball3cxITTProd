const axios = require('axios');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
});

class SmokeballService {
    constructor() {
        this.apiKey = process.env.SMOKEBALL_API_KEY;
        this.apiUrl = process.env.SMOKEBALL_API_URL || 'https://stagingapi.smokeball.com.au';
    }

    /** Return standard headers for every Smokeball API call. */
    _headers(accessToken) {
        if (!accessToken) {
            throw new Error('Access token is required for Smokeball API calls');
        }
        return {
            Authorization: `Bearer ${accessToken}`,
            'x-api-key': this.apiKey,
        };
    }

    /** Fetch all contacts (paginated). */
    async fetchContacts(accessToken, offset = 0, limit = 500) {
        const headers = this._headers(accessToken);
        const response = await axios.get(`${this.apiUrl}/contacts/`, {
            headers,
            params: { offset, limit },
        });
        return response.data;
    }

    /** Fetch a single contact by ID. */
    async fetchContactById(accessToken, contactId) {
        const headers = this._headers(accessToken);
        const response = await axios.get(`${this.apiUrl}/contacts/${contactId}`, { headers });
        return response.data;
    }

    /**
     * Search contacts by phone number.
     * The Smokeball API does not expose a native phone-search endpoint, so we
     * iterate through paginated contacts and match locally.
     */
    async searchContactByPhone(accessToken, phoneNumber) {
        const normalised = phoneNumber.replace(/\D/g, ''); // digits only
        let offset = 0;
        const limit = 500;

        const getDigits = (phoneObj) => {
            if (!phoneObj) return '';
            const raw = `${phoneObj.areaCode || ''}${phoneObj.number || ''}`;
            return raw.replace(/\D/g, '');
        };

        const phoneMatch = (digits) => {
            if (!digits) return false;
            return digits.endsWith(normalised) || normalised.endsWith(digits);
        };

        while (true) {
            const page = await this.fetchContacts(accessToken, offset, limit);
            const contacts = page.value || [];

            for (const contact of contacts) {
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
}

module.exports = new SmokeballService();
