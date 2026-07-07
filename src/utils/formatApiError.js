/** Flatten axios / API errors for logs and HTTP responses. */
function formatApiError(err) {
    if (!err) return 'Unknown error';
    if (err.response?.data) {
        const data = err.response.data;
        if (typeof data === 'string') return data;
        try {
            return JSON.stringify(data);
        } catch {
            return String(data);
        }
    }
    return err.message || String(err);
}

module.exports = { formatApiError };
