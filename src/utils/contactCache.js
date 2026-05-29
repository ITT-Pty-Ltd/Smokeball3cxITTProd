/** Short-lived cache of contact display data populated during 3CX lookup. */
const TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map();

function set(contactId, data) {
    cache.set(contactId, { ...data, expiresAt: Date.now() + TTL_MS });
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

module.exports = { set, get };
