const config = require('../config');
const smokeballService = require('./smokeball');
const { resolveStaffForAgent, staffDisplayName } = require('../utils/staffLookup');
const { logger } = require('../logger');

function pickString(body, ...keys) {
    for (const key of keys) {
        const value = body[key];
        if (value != null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }
    return '';
}

function buildTaskSubject(payload, contactName) {
    const callType = pickString(payload, 'CallType', 'callType') || 'Call';
    const party = contactName || pickString(payload, 'Name', 'name') || pickString(payload, 'Number', 'number') || 'Unknown';
    return `3CX ${callType}: ${party}`.slice(0, 200);
}

function appendSection(lines, title, value) {
    if (!value) return;
    lines.push(`${title}:`);
    lines.push(value);
    lines.push('');
}

function buildTaskNote(payload, contactName, staff) {
    const lines = [];

    appendSection(lines, 'Call type', pickString(payload, 'CallType', 'callType'));
    appendSection(lines, 'Direction', pickString(payload, 'CallDirection', 'callDirection'));
    appendSection(lines, 'Date/time', pickString(payload, 'DateTime', 'dateTime'));
    appendSection(lines, 'Duration', pickString(payload, 'Duration', 'duration'));
    appendSection(lines, 'Phone number', pickString(payload, 'Number', 'number'));
    appendSection(lines, 'Contact', contactName || pickString(payload, 'Name', 'name'));
    appendSection(lines, 'Contact ID', pickString(payload, 'ContactId', 'contactId', 'EntityId', 'entityId'));

    const agentParts = [
        pickString(payload, 'AgentFirstName', 'agentFirstName'),
        pickString(payload, 'AgentLastName', 'agentLastName'),
    ].filter(Boolean);
    const agentLabel = agentParts.length
        ? `${agentParts.join(' ')} (ext ${pickString(payload, 'Agent', 'agent')})`
        : pickString(payload, 'Agent', 'agent');
    appendSection(lines, 'Agent', agentLabel);
    appendSection(lines, 'Agent email', pickString(payload, 'AgentEmail', 'agentEmail'));

    if (staff?.id) {
        appendSection(lines, 'Assigned Smokeball staff', `${staffDisplayName(staff) || staff.id} (${staff.id})`);
    }

    appendSection(lines, 'Summary', pickString(payload, 'Summary', 'summary'));
    appendSection(lines, 'Transcription', pickString(payload, 'Transcription', 'transcription'));
    appendSection(
        lines,
        'Sentiment',
        pickString(payload, 'Sentiment', 'sentiment', 'SentimentScore', 'sentimentScore')
    );
    appendSection(lines, 'Recording', pickString(payload, 'RecordUrl', 'recordUrl', 'RecordingUrl', 'recordingUrl'));

    return lines.join('\n').trim();
}

async function resolveContactName(accessToken, contactId) {
    if (!contactId) return '';

    try {
        const contact = await smokeballService.fetchContactById(accessToken, contactId);
        if (contact.person) {
            return [contact.person.firstName, contact.person.lastName].filter(Boolean).join(' ');
        }
        if (contact.company?.name) {
            return contact.company.name;
        }
    } catch (err) {
        logger.warn(`Could not load contact ${contactId} for journal task:`, err.message);
    }

    return '';
}

/**
 * Create a Smokeball task from a 3CX journal payload (no matter linkage).
 */
async function processCallJournal(accessToken, body) {
    if (!config.journal.createTasks) {
        logger.info('Call journal received (task creation disabled)');
        return { status: 'skipped', reason: 'task_creation_disabled' };
    }

    const agent = {
        extension: pickString(body, 'Agent', 'agent'),
        email: pickString(body, 'AgentEmail', 'agentEmail'),
        firstName: pickString(body, 'AgentFirstName', 'agentFirstName'),
        lastName: pickString(body, 'AgentLastName', 'agentLastName'),
    };

    const staff = await resolveStaffForAgent(
        accessToken,
        agent,
        config.smokeball.defaultStaffId
    );
    if (!staff?.id) {
        return {
            status: 'failed',
            reason: 'staff_not_found',
            message: 'Could not resolve Smokeball staff for agent and no default staff configured',
        };
    }

    const contactId = pickString(body, 'ContactId', 'contactId', 'EntityId', 'entityId');
    const contactName =
        pickString(body, 'Name', 'name') || (await resolveContactName(accessToken, contactId));

    const subject = buildTaskSubject(body, contactName);
    const note = buildTaskNote(body, contactName, staff);

    const task = {
        staffId: staff.id,
        assigneeIds: [staff.id],
        subject,
        note,
        isCompleted: false,
    };

    const result = await smokeballService.createTask(
        accessToken,
        task,
        staff.userId ? { userId: staff.userId } : {}
    );
    const taskId = result?.id || result?.href || null;
    logger.info(
        `Smokeball task created for journal: subject="${subject}", staffId=${staff.id}, taskId=${taskId || 'pending (async)'}`
    );

    return {
        status: 'created',
        taskId,
        staffId: staff.id,
        subject,
    };
}

module.exports = {
    processCallJournal,
    buildTaskSubject,
    buildTaskNote,
};
