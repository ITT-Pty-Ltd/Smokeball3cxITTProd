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

    /** Return standard headers using the token passed dynamically from 3CX. */
    _headers(accessToken) {
        return {
            Authorization: `Bearer ${accessToken}`,
            'x-api-key': this.apiKey,
        };
    }

    /** Fetch all contacts (paginated) using dynamic token. */
    async fetchContacts(accessToken, offset = 0, limit = 500) {
        const headers = this._headers(accessToken);
        const response = await axios.get(`${this.apiUrl}/contacts/`, {
            headers,
            params: { offset, limit },
        });
        return response.data;
    }

    /**
     * Search contacts by phone number using dynamic token.
     * Iterates through paginated contacts and matches locally.
     */
    async searchContactByPhone(phoneNumber, accessToken) {
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
            const page = await this.fetchContacts(accessToken, offset, limit);
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
}

module.exports = new SmokeballService();
