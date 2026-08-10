/**
 * Format 3CX call transcriptions so each speaker turn is labeled:
 *   Deana Hanna – "XXX"
 *   John Smith – "XXX"
 */

function pickString(body, ...keys) {
    for (const key of keys) {
        const value = body?.[key];
        if (value != null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }
    return '';
}

function stripWrappingQuotes(text) {
    const t = text.trim();
    if (
        (t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith('\u201C') && t.endsWith('\u201D'))
    ) {
        return t.slice(1, -1).trim();
    }
    return t;
}

function formatSpeakerLine(speaker, utterance) {
    const name = (speaker || 'Unknown').trim();
    const text = stripWrappingQuotes(utterance || '').trim();
    if (!text) return null;
    return `${name} – "${text}"`;
}

/**
 * Build a map of generic labels (Speaker 1, Agent, External, …) → display names.
 */
function buildSpeakerAliases(payload = {}) {
    const agentName = [
        pickString(payload, 'AgentFirstName', 'agentFirstName'),
        pickString(payload, 'AgentLastName', 'agentLastName'),
    ]
        .filter(Boolean)
        .join(' ')
        .trim();

    const contactName =
        pickString(payload, 'Name', 'name', 'ContactName', 'contactName') || 'Caller';

    const aliases = new Map();

    const add = (key, value) => {
        if (!key || !value) return;
        aliases.set(String(key).trim().toLowerCase(), value);
    };

    if (agentName) {
        add('agent', agentName);
        add('internal', agentName);
        add('staff', agentName);
        add('employee', agentName);
        add('speaker 1', agentName);
        add('speaker1', agentName);
        add(agentName, agentName);
    }

    add('external', contactName);
    add('caller', contactName);
    add('customer', contactName);
    add('client', contactName);
    add('contact', contactName);
    add('speaker 2', contactName);
    add('speaker2', contactName);
    add(contactName, contactName);

    return { aliases, agentName, contactName };
}

function resolveSpeakerLabel(rawSpeaker, aliases) {
    const key = String(rawSpeaker || '').trim().toLowerCase();
    if (!key) return 'Unknown';
    return aliases.get(key) || String(rawSpeaker).trim();
}

/**
 * Parse common 3CX / AI transcript shapes into [{ speaker, text }].
 */
function parseTranscriptTurns(raw) {
    if (!raw || !String(raw).trim()) return [];

    const text = String(raw).replace(/\r\n/g, '\n').trim();

    // JSON array of turns: [{ speaker, text }] or [{ name, utterance }]
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((item) => ({
                        speaker: item.speaker || item.name || item.role || item.Speaker || '',
                        text: item.text || item.utterance || item.message || item.content || '',
                    }))
                    .filter((t) => t.text);
            }
        } catch {
            // fall through to line parsing
        }
    }

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const turns = [];

    // "Name – quote" / "Name - quote" / "Name: quote" / "Name – "quote""
    const lineRe =
        /^([^:\u2013\-]{1,80}?)\s*(?:[:\u2013\-–—]|–)\s*[\"\u201C]?(.+?)[\"\u201D]?$/;

    for (const line of lines) {
        const match = line.match(lineRe);
        if (match) {
            turns.push({ speaker: match[1].trim(), text: match[2].trim() });
        } else if (turns.length) {
            // Continuation line belonging to previous speaker
            turns[turns.length - 1].text += ` ${line}`;
        } else {
            turns.push({ speaker: '', text: line });
        }
    }

    return turns;
}

/**
 * Return a speaker-labeled transcript string for task notes.
 */
function formatTranscriptWithSpeakers(rawTranscription, payload = {}) {
    if (!rawTranscription || !String(rawTranscription).trim()) return '';

    const { aliases, agentName, contactName } = buildSpeakerAliases(payload);
    const turns = parseTranscriptTurns(rawTranscription);

    if (!turns.length) {
        return String(rawTranscription).trim();
    }

    // If nothing had a speaker and we only have one blob, keep original
    const anySpeaker = turns.some((t) => t.speaker);
    if (!anySpeaker && turns.length === 1) {
        return String(rawTranscription).trim();
    }

    let unlabeledIndex = 0;
    const lines = [];

    for (const turn of turns) {
        let speaker = turn.speaker;
        if (!speaker) {
            // Alternate agent / contact for unlabeled turns when possible
            if (agentName && contactName) {
                speaker = unlabeledIndex % 2 === 0 ? agentName : contactName;
                unlabeledIndex += 1;
            } else {
                speaker = 'Unknown';
            }
        } else {
            speaker = resolveSpeakerLabel(speaker, aliases);
        }

        const line = formatSpeakerLine(speaker, turn.text);
        if (line) lines.push(line);
    }

    return lines.join('\n\n');
}

module.exports = {
    formatTranscriptWithSpeakers,
    parseTranscriptTurns,
    formatSpeakerLine,
};
