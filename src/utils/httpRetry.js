const axios = require('axios');
const { logger } = require('../logger');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an axios request with exponential backoff on 429 and 5xx errors.
 * Honors Retry-After header when present (seconds).
 */
async function requestWithRetry(requestFn, options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 500;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await requestFn();
        } catch (err) {
            const status = err.response?.status;
            const retryable = status === 429 || (status >= 500 && status < 600);

            if (!retryable || attempt === maxRetries) {
                throw err;
            }

            const retryAfterHeader = err.response?.headers?.['retry-after'];
            const retryAfterMs = retryAfterHeader
                ? Math.max(parseInt(retryAfterHeader, 10) || 1, 1) * 1000
                : baseDelayMs * 2 ** attempt;

            logger.warn(
                `Smokeball API ${status}, retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${maxRetries})`
            );
            await sleep(retryAfterMs);
        }
    }
}

module.exports = { requestWithRetry, sleep };
