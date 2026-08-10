const config = require('../config');
const smokeballService = require('./smokeball');
const { resolveStaffForAgent, staffDisplayName } = require('../utils/staffLookup');
const { resolveMatterForContact, matterDisplayName } = require('../utils/matterLookup');
const { formatTranscriptWithSpeakers } = require('../utils/transcriptFormat');
const { durationToMinutes, durationToIso8601 } = require('../utils/duration');
const { formatApiError } = require('../utils/formatApiError');
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

function isMissedOrUnanswered(callType) {
    const t = String(callType || '').toLowerCase();
    return (
        t.includes('missed') ||
        t.includes('notanswered') ||
        t.includes('not answered') ||
        t.includes('unanswered')
    );
}

function buildTaskSubject(payload, contactName, kind = 'Call') {
    const callType = pickString(payload, 'CallType', 'callType') || kind;
    const party =
        contactName ||
        pickString(payload, 'Name', 'name') ||
        pickString(payload, 'Number', 'number', 'Email', 'email') ||
        'Unknown';
    return `3CX ${callType}: ${party}`.slice(0, 200);
}

function appendSection(lines, title, value) {
    if (!value) return;
    lines.push(`${title}:`);
    lines.push(value);
    lines.push('');
}

function buildAgentLabel(payload) {
    const agentParts = [
        pickString(payload, 'AgentFirstName', 'agentFirstName'),
        pickString(payload, 'AgentLastName', 'agentLastName'),
    ].filter(Boolean);
    return agentParts.length
        ? `${agentParts.join(' ')} (ext ${pickString(payload, 'Agent', 'agent')})`
        : pickString(payload, 'Agent', 'agent');
}

function buildCallTaskNote(payload, contactName, staff, matter, formattedTranscript) {
    const lines = [];

    appendSection(lines, 'Call type', pickString(payload, 'CallType', 'callType'));
    appendSection(lines, 'Direction', pickString(payload, 'CallDirection', 'callDirection'));
    appendSection(lines, 'Date/time', pickString(payload, 'DateTime', 'dateTime'));
    appendSection(lines, 'Duration', pickString(payload, 'Duration', 'duration'));
    appendSection(lines, 'Phone number', pickString(payload, 'Number', 'number'));
    appendSection(lines, 'Contact', contactName || pickString(payload, 'Name', 'name'));
    appendSection(lines, 'Contact ID', pickString(payload, 'ContactId', 'contactId', 'EntityId', 'entityId'));

    if (matter?.id) {
        appendSection(lines, 'Matter', `${matterDisplayName(matter)} (${matter.id})`);
    }

    appendSection(lines, 'Agent', buildAgentLabel(payload));
    appendSection(lines, 'Agent email', pickString(payload, 'AgentEmail', 'agentEmail'));

    if (staff?.id) {
        appendSection(
            lines,
            'Assigned Smokeball staff',
            `${staffDisplayName(staff) || staff.id} (${staff.id})`
        );
    }

    appendSection(lines, 'Summary', pickString(payload, 'Summary', 'summary'));
    appendSection(lines, 'Transcription', formattedTranscript);
    appendSection(
        lines,
        'Sentiment',
        pickString(payload, 'Sentiment', 'sentiment', 'SentimentScore', 'sentimentScore')
    );
    appendSection(
        lines,
        'Recording',
        pickString(payload, 'RecordUrl', 'recordUrl', 'RecordingUrl', 'recordingUrl')
    );

    return lines.join('\n').trim();
}

function buildChatTaskNote(payload, contactName, staff, matter) {
    const lines = [];

    appendSection(lines, 'Chat type', pickString(payload, 'ChatType', 'chatType') || 'Chat / SMS');
    appendSection(lines, 'Date/time', pickString(payload, 'DateTime', 'dateTime'));
    appendSection(lines, 'Duration', pickString(payload, 'Duration', 'duration'));
    appendSection(lines, 'Phone number', pickString(payload, 'Number', 'number'));
    appendSection(lines, 'Email', pickString(payload, 'Email', 'email'));
    appendSection(lines, 'Contact', contactName || pickString(payload, 'Name', 'name'));
    appendSection(lines, 'Contact ID', pickString(payload, 'ContactId', 'contactId', 'EntityId', 'entityId'));

    if (matter?.id) {
        appendSection(lines, 'Matter', `${matterDisplayName(matter)} (${matter.id})`);
    }

    appendSection(lines, 'Agent', buildAgentLabel(payload));
    appendSection(lines, 'Agent email', pickString(payload, 'AgentEmail', 'agentEmail'));

    if (staff?.id) {
        appendSection(
            lines,
            'Assigned Smokeball staff',
            `${staffDisplayName(staff) || staff.id} (${staff.id})`
        );
    }

    appendSection(
        lines,
        'Message thread',
        pickString(payload, 'ChatMessages', 'chatMessages', 'Messages', 'messages')
    );

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

async function resolveJournalActors(accessToken, body) {
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

    const contactId = pickString(body, 'ContactId', 'contactId', 'EntityId', 'entityId');
    const contactName =
        pickString(body, 'Name', 'name') || (await resolveContactName(accessToken, contactId));

    const matter = contactId ? await resolveMatterForContact(accessToken, contactId) : null;

    return { staff, contactId, contactName, matter };
}

function shouldSkipJournal(body, { contactId, matter }, kind) {
    if (!config.journal.createTasks) {
        return { status: 'skipped', reason: 'task_creation_disabled' };
    }

    if (kind === 'call' && config.journal.skipMissed && isMissedOrUnanswered(pickString(body, 'CallType', 'callType'))) {
        return { status: 'skipped', reason: 'missed_or_unanswered' };
    }

    if (config.journal.requireContact && !contactId) {
        return {
            status: 'skipped',
            reason: 'contact_required',
            message: 'No matched Smokeball contact — journal skipped (JOURNAL_REQUIRE_CONTACT=true)',
        };
    }

    if (config.journal.requireMatter && !matter?.id) {
        return {
            status: 'skipped',
            reason: 'matter_required',
            message: 'No Smokeball matter for contact — journal skipped (JOURNAL_REQUIRE_MATTER=true)',
        };
    }

    return null;
}

async function createTimeEntry(accessToken, { matter, staff, subject, description, durationRaw, dateTime }) {
    if (!config.journal.createTimeEntries || !matter?.id) {
        return null;
    }

    const minutes = durationToMinutes(durationRaw);
    if (minutes <= 0) {
        logger.info('Time entry skipped: call/chat duration is zero');
        return null;
    }

    const fee = {
        feeType: 1,
        feeDate: dateTime || new Date().toISOString(),
        subject: (subject || '3CX call').slice(0, 200),
        description: description || undefined,
        duration: minutes,
        durationWorked: minutes,
        staffId: staff.id,
        isBillable: true,
        finalized: false,
    };

    if (config.smokeball.timeActivityCode) {
        fee.activityCode = config.smokeball.timeActivityCode;
    }

    try {
        const result = await smokeballService.createFee(
            accessToken,
            matter.id,
            fee,
            staff.userId ? { userId: staff.userId } : {}
        );
        const feeId = result?.id || result?.href || null;
        logger.info(
            `Smokeball time entry created: matterId=${matter.id}, minutes=${minutes}, feeId=${feeId || 'pending (async)'}`
        );
        return { feeId, minutes };
    } catch (err) {
        logger.error(`Failed to create Smokeball time entry: ${formatApiError(err)}`);
        return { error: formatApiError(err) };
    }
}

/**
 * Create a Smokeball task (and optional time entry) from a 3CX call journal payload.
 */
async function processCallJournal(accessToken, body) {
    const actors = await resolveJournalActors(accessToken, body);
    const skip = shouldSkipJournal(body, actors, 'call');
    if (skip) {
        logger.info(`Call journal skipped: ${skip.reason}`);
        return skip;
    }

    const { staff, contactId, contactName, matter } = actors;
    if (!staff?.id) {
        return {
            status: 'failed',
            reason: 'staff_not_found',
            message: 'Could not resolve Smokeball staff for agent and no default staff configured',
        };
    }

    const rawTranscript = pickString(body, 'Transcription', 'transcription');
    const formattedTranscript = formatTranscriptWithSpeakers(rawTranscript, {
        ...body,
        Name: contactName || pickString(body, 'Name', 'name'),
    });

    const subject = buildTaskSubject(body, contactName, 'Call');
    const note = buildCallTaskNote(body, contactName, staff, matter, formattedTranscript);
    const isoDuration = durationToIso8601(pickString(body, 'Duration', 'duration'));

    const task = {
        staffId: staff.id,
        assigneeIds: [staff.id],
        subject,
        note,
        isCompleted: false,
    };
    if (matter?.id) task.matterId = matter.id;
    if (isoDuration) task.duration = isoDuration;

    const result = await smokeballService.createTask(
        accessToken,
        task,
        staff.userId ? { userId: staff.userId } : {}
    );
    const taskId = result?.id || result?.href || null;
    logger.info(
        `Smokeball task created for call journal: subject="${subject}", staffId=${staff.id}, matterId=${matter?.id || 'none'}, taskId=${taskId || 'pending (async)'}`
    );

    const timeEntry = await createTimeEntry(accessToken, {
        matter,
        staff,
        subject,
        description: note,
        durationRaw: pickString(body, 'Duration', 'duration'),
        dateTime: pickString(body, 'DateTime', 'dateTime') || undefined,
    });

    return {
        status: 'created',
        taskId,
        staffId: staff.id,
        matterId: matter?.id || null,
        contactId: contactId || null,
        subject,
        timeEntry,
    };
}

/**
 * Create a Smokeball task from a 3CX chat / SMS journal payload.
 */
async function processChatJournal(accessToken, body) {
    const actors = await resolveJournalActors(accessToken, body);
    const skip = shouldSkipJournal(body, actors, 'chat');
    if (skip) {
        logger.info(`Chat journal skipped: ${skip.reason}`);
        return skip;
    }

    const { staff, contactId, contactName, matter } = actors;
    if (!staff?.id) {
        return {
            status: 'failed',
            reason: 'staff_not_found',
            message: 'Could not resolve Smokeball staff for agent and no default staff configured',
        };
    }

    const subject = buildTaskSubject(body, contactName, 'Chat');
    const note = buildChatTaskNote(body, contactName, staff, matter);
    const isoDuration = durationToIso8601(pickString(body, 'Duration', 'duration'));

    const task = {
        staffId: staff.id,
        assigneeIds: [staff.id],
        subject,
        note,
        isCompleted: false,
    };
    if (matter?.id) task.matterId = matter.id;
    if (isoDuration) task.duration = isoDuration;

    const result = await smokeballService.createTask(
        accessToken,
        task,
        staff.userId ? { userId: staff.userId } : {}
    );
    const taskId = result?.id || result?.href || null;
    logger.info(
        `Smokeball task created for chat journal: subject="${subject}", staffId=${staff.id}, matterId=${matter?.id || 'none'}, taskId=${taskId || 'pending (async)'}`
    );

    return {
        status: 'created',
        taskId,
        staffId: staff.id,
        matterId: matter?.id || null,
        contactId: contactId || null,
        subject,
    };
}

module.exports = {
    processCallJournal,
    processChatJournal,
    buildTaskSubject,
    buildCallTaskNote,
    buildChatTaskNote,
};
