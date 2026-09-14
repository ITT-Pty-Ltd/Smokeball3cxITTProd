/**
 * Extract AI summary / transcription fields from 3CX journal payloads.
 * 3CX may send dedicated JSON keys, structured objects, or only the expanded
 * call-journal text (InboundCallText with [Transcription] / [Summary] substituted).
 */

function pickString(body, ...keys) {
    for (const key of keys) {
        const value = body?.[key];
        if (value == null) continue;
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
}

function normalizeJournalValue(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw.trim();
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
    if (Array.isArray(raw)) {
        if (!raw.length) return '';
        return raw;
    }
    if (typeof raw === 'object') {
        if (typeof raw.text === 'string' && raw.text.trim()) return raw.text.trim();
        if (typeof raw.content === 'string' && raw.content.trim()) return raw.content.trim();
        if (typeof raw.transcription === 'string' && raw.transcription.trim()) {
            return raw.transcription.trim();
        }
        if (Array.isArray(raw.turns) && raw.turns.length) return raw.turns;
        if (Array.isArray(raw.segments) && raw.segments.length) return raw.segments;
        try {
            return JSON.stringify(raw);
        } catch {
            return String(raw).trim();
        }
    }
    return String(raw).trim();
}

function pickJournalValue(body, ...keys) {
    for (const key of keys) {
        const normalized = normalizeJournalValue(body?.[key]);
        if (normalized) return normalized;
    }
    return '';
}

const SECTION_LABELS =
    'Summary|Transcription|Recording|Sentiment|Notes|Action Items|Score|Call type|Direction';

function extractSection(text, label) {
    if (!text) return '';
    // 3CX may use single or double line breaks between sections in RenderedJournal.
    const pattern = new RegExp(
        `(?:^|\\n)${label}\\s*:\\s*([\\s\\S]*?)(?=\\n+?(?:${SECTION_LABELS})\\s*:|$)`,
        'i'
    );
    const match = String(text).match(pattern);
    return match?.[1]?.trim() || '';
}

function redactRecordingUrls(text) {
    return String(text || '').replace(
        /https?:\/\/[^\s]+/gi,
        '[recording-url]'
    );
}

function extractFromRenderedJournal(text) {
    const rendered = String(text || '').trim();
    if (!rendered) {
        return { summary: '', transcript: '', notes: '', actionItems: '' };
    }

    return {
        summary: extractSection(rendered, 'Summary'),
        transcript: extractSection(rendered, 'Transcription'),
        notes: extractSection(rendered, 'Notes'),
        actionItems: extractSection(rendered, 'Action Items'),
    };
}

function textLength(value) {
    if (!value) return 0;
    if (Array.isArray(value)) return JSON.stringify(value).length;
    return String(value).length;
}

/**
 * Resolve summary, transcript, and related AI fields from a journal body.
 */
function extractCallJournalAiFields(body = {}) {
    const renderedJournal = pickString(
        body,
        'RenderedJournal',
        'renderedJournal',
        'CallDescription',
        'callDescription',
        'InboundCallText',
        'inboundCallText',
        'OutboundCallText',
        'outboundCallText',
        'Description',
        'description',
        'CallNotes',
        'callNotes',
        'Notes',
        'notes'
    );

    const fromRendered = extractFromRenderedJournal(renderedJournal);

    const summary =
        pickJournalValue(body, 'Summary', 'summary', 'CallSummary', 'callSummary') ||
        fromRendered.summary;

    const transcript =
        pickJournalValue(
            body,
            'Transcription',
            'transcription',
            'Transcript',
            'transcript',
            'CallTranscription',
            'callTranscription'
        ) || fromRendered.transcript;

    const aiNotes =
        pickJournalValue(body, 'AiNotes', 'aiNotes', 'CallNotes', 'callNotes') || fromRendered.notes;

    const actionItems =
        pickJournalValue(body, 'ActionItems', 'actionItems', 'ActionItem', 'actionItem') ||
        fromRendered.actionItems;

    const sentiment = pickString(
        body,
        'Sentiment',
        'sentiment',
        'SentimentScore',
        'sentimentScore'
    );

    const recordingUrl = pickString(
        body,
        'RecordUrl',
        'recordUrl',
        'RecordingUrl',
        'recordingUrl'
    );

    const diagnostics = {
        renderedJournalLen: renderedJournal.length,
        summaryLen: textLength(summary),
        transcriptLen: textLength(transcript),
        aiNotesLen: textLength(aiNotes),
        actionItemsLen: textLength(actionItems),
        hasRecording: Boolean(recordingUrl),
        payloadKeys: Object.keys(body || {}).sort(),
    };

    return {
        summary,
        transcript,
        aiNotes,
        actionItems,
        sentiment,
        recordingUrl,
        renderedJournal,
        diagnostics,
    };
}

const SMOKEBALL_TASK_NOTE_LIMIT = 3000;

function truncateTaskNote(note, limit = SMOKEBALL_TASK_NOTE_LIMIT) {
    const text = String(note || '').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 40).trimEnd()}\n\n[Truncated — exceeded Smokeball note limit]`;
}

module.exports = {
    extractCallJournalAiFields,
    extractFromRenderedJournal,
    truncateTaskNote,
    redactRecordingUrls,
    SMOKEBALL_TASK_NOTE_LIMIT,
};
