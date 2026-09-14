const winston = require('winston');

const logHistory = [];
const MAX_LOGS = 100;

class MemoryTransport extends winston.Transport {
    log(info, callback) {
        const msg = info.message || '';
        const isError = info.level === 'error' || info.level === 'warn';
        const isApiHit = msg.includes(' /api/') && !msg.includes(' /api/logs');
        const isAuthLog =
            msg.includes('OAuth') ||
            msg.includes('Authentication') ||
            msg.includes('Server listening') ||
            msg.includes('Stateless');
        const isCrmLog =
            msg.includes('3CX lookup') ||
            msg.includes('3CX search') ||
            msg.includes('3CX journal') ||
            msg.includes('journal skipped') ||
            msg.includes('Smokeball task') ||
            msg.includes('Smokeball phone search') ||
            msg.includes('Match found') ||
            msg.includes('No Smokeball contact');

        if (isError || isApiHit || isAuthLog || isCrmLog) {
            logHistory.push({
                timestamp: info.timestamp || new Date().toISOString(),
                level: info.level,
                message: msg,
            });
            if (logHistory.length > MAX_LOGS) {
                logHistory.shift();
            }
        }
        callback();
    }
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console(), new MemoryTransport()],
});

function getLogHistory() {
    return logHistory;
}

module.exports = { logger, getLogHistory };
