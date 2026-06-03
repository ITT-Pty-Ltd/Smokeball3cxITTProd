const smokeballService = require('../services/smokeball');
const { logger } = require('../logger');

function normaliseEmail(value) {
    return (value || '').trim().toLowerCase();
}

function normaliseName(value) {
    return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function staffDisplayName(staff) {
    return [staff.firstName, staff.lastName].filter(Boolean).join(' ').trim();
}

function isActiveStaff(staff) {
    return staff && staff.enabled !== false && staff.former !== true && staff.id;
}

/** Prefer exact email match, then exact full name, then first active result. */
function pickBestStaffMatch(candidates, { email, fullName }) {
    const active = candidates.filter(isActiveStaff);
    if (!active.length) return null;

    const targetEmail = normaliseEmail(email);
    if (targetEmail) {
        const byEmail = active.find((s) => normaliseEmail(s.email) === targetEmail);
        if (byEmail) return byEmail;
    }

    const targetName = normaliseName(fullName);
    if (targetName) {
        const byName = active.find((s) => normaliseName(staffDisplayName(s)) === targetName);
        if (byName) return byName;
    }

    return active[0];
}

/**
 * Resolve Smokeball staff for a 3CX agent using email first, then name search.
 * Falls back to config.smokeball.defaultStaffId when lookup fails.
 */
async function resolveStaffForAgent(accessToken, agent, defaultStaffId) {
    const email = (agent.email || '').trim();
    const fullName = [agent.firstName, agent.lastName].filter(Boolean).join(' ').trim();
    const attempts = [];

    if (email) {
        attempts.push({ label: 'email', terms: [`email:${email}`] });
    }
    if (fullName) {
        attempts.push({ label: 'name', terms: [`name:${fullName}`] });
        if (agent.lastName && agent.firstName) {
            attempts.push({ label: 'name', terms: [`name:${agent.lastName}, ${agent.firstName}`] });
        }
    }

    for (const attempt of attempts) {
        try {
            const page = await smokeballService.searchStaff(accessToken, attempt.terms);
            const match = pickBestStaffMatch(page.value || [], { email, fullName });
            if (match) {
                logger.info(
                    `Staff lookup (${attempt.label}): matched ${staffDisplayName(match)} (${match.id}) for agent ext ${agent.extension || 'n/a'}`
                );
                return match;
            }
        } catch (err) {
            logger.warn(`Staff lookup (${attempt.label}) failed:`, err.response?.data || err.message);
        }
    }

    if (defaultStaffId) {
        logger.warn(
            `Staff lookup: no match for agent ext ${agent.extension || 'n/a'} (${email || fullName || 'no email/name'}); using default staff ${defaultStaffId}`
        );
        return { id: defaultStaffId, userId: null };
    }

    logger.error(
        `Staff lookup: no match for agent ext ${agent.extension || 'n/a'} (${email || fullName || 'no email/name'}) and SMOKEBALL_DEFAULT_STAFF_ID is not set`
    );
    return null;
}

module.exports = {
    resolveStaffForAgent,
    pickBestStaffMatch,
    staffDisplayName,
};
