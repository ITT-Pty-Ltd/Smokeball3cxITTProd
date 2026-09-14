/** Short-lived cache of contact display data populated during 3CX lookup. */
const { canonicalAuDigits } = require('./phoneNormalize');

const TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map();
const byPhone = new Map();

function phoneKey(phoneNumber) {
    const digits = canonicalAuDigits(phoneNumber);
    return digits || String(phoneNumber || '').replace(/\D/g, '');
}

function set(contactId, data) {
    cache.set(contactId, { ...data, expiresAt: Date.now() + TTL_MS });
    const key = phoneKey(data.phone || data.phoneMobile);
    if (key) {
        byPhone.set(key, contactId);
    }
}

function get(contactId) {
    const entry = cache.get(contactId);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        cache.delete(contactId);
        return null;
    }
    return entry;
}

function getByPhone(phoneNumber) {
    const key = phoneKey(phoneNumber);
    if (!key) return null;
    const contactId = byPhone.get(key);
    if (!contactId) return null;
    return get(contactId);
}

module.exports = { set, get, getByPhone };
