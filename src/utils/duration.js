/**
 * Parse 3CX duration strings (hh:mm:ss, mm:ss, or seconds) into minutes / ISO-8601.
 */

function parseDurationParts(raw) {
    if (raw == null || raw === '') return null;

    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const totalSeconds = Math.max(0, Math.round(raw));
        return {
            hours: Math.floor(totalSeconds / 3600),
            minutes: Math.floor((totalSeconds % 3600) / 60),
            seconds: totalSeconds % 60,
            totalSeconds,
        };
    }

    const text = String(raw).trim();
    if (!text) return null;

    if (/^\d+$/.test(text)) {
        const totalSeconds = Math.max(0, parseInt(text, 10));
        return {
            hours: Math.floor(totalSeconds / 3600),
            minutes: Math.floor((totalSeconds % 3600) / 60),
            seconds: totalSeconds % 60,
            totalSeconds,
        };
    }

    const match = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!match) return null;

    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (match[3] != null) {
        hours = parseInt(match[1], 10);
        minutes = parseInt(match[2], 10);
        seconds = parseInt(match[3], 10);
    } else {
        minutes = parseInt(match[1], 10);
        seconds = parseInt(match[2], 10);
    }

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return { hours, minutes, seconds, totalSeconds };
}

/** Whole minutes for Smokeball fee duration (rounds up partial minutes). */
function durationToMinutes(raw) {
    const parts = parseDurationParts(raw);
    if (!parts || parts.totalSeconds <= 0) return 0;
    return Math.max(1, Math.ceil(parts.totalSeconds / 60));
}

/** ISO-8601 duration for Smokeball task.duration (e.g. PT5M30S). */
function durationToIso8601(raw) {
    const parts = parseDurationParts(raw);
    if (!parts || parts.totalSeconds <= 0) return null;

    const { hours, minutes, seconds } = parts;
    let out = 'PT';
    if (hours) out += `${hours}H`;
    if (minutes) out += `${minutes}M`;
    if (seconds || (!hours && !minutes)) out += `${seconds}S`;
    return out;
}

module.exports = {
    parseDurationParts,
    durationToMinutes,
    durationToIso8601,
};
