const smokeballService = require('../services/smokeball');
const { formatApiError } = require('./formatApiError');
const { logger } = require('../logger');

const OPENISH = new Set(['open', 'pending']);

function matterStatus(matter) {
    return String(matter?.status || matter?.Status || '').toLowerCase();
}

function matterDisplayName(matter) {
    return (
        matter?.number ||
        matter?.matterNumber ||
        matter?.description ||
        matter?.title ||
        matter?.id ||
        'Unknown matter'
    );
}

/**
 * Prefer Open, then Pending; among those, most recently updated.
 */
function pickBestMatter(matters) {
    if (!matters?.length) return null;

    const ranked = matters
        .filter((m) => m && m.id && !m.isDeleted)
        .map((m) => {
            const status = matterStatus(m);
            let rank = 99;
            if (status === 'open') rank = 0;
            else if (status === 'pending') rank = 1;
            else if (OPENISH.has(status)) rank = 2;
            return { matter: m, rank, lastUpdated: m.lastUpdated || 0 };
        })
        .sort((a, b) => a.rank - b.rank || b.lastUpdated - a.lastUpdated);

    return ranked[0]?.matter || null;
}

/**
 * Resolve the best Smokeball matter for a contact (for task + time entry linkage).
 */
async function resolveMatterForContact(accessToken, contactId) {
    if (!contactId) return null;

    try {
        // Prefer open/pending matters for this contact
        let page = await smokeballService.listMatters(accessToken, {
            contactId,
            status: ['Open', 'Pending'],
            limit: 50,
        });
        let best = pickBestMatter(page.value || []);

        if (!best) {
            page = await smokeballService.listMatters(accessToken, {
                contactId,
                limit: 50,
            });
            best = pickBestMatter(page.value || []);
        }

        if (best) {
            logger.info(
                `Matter lookup: contact=${contactId} -> ${matterDisplayName(best)} (${best.id}, status=${best.status || 'n/a'})`
            );
        } else {
            logger.info(`Matter lookup: no matters for contact=${contactId}`);
        }

        return best;
    } catch (err) {
        logger.warn(`Matter lookup failed for contact ${contactId}: ${formatApiError(err)}`);
        return null;
    }
}

module.exports = {
    resolveMatterForContact,
    pickBestMatter,
    matterDisplayName,
};
