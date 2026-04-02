require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const winston = require('winston');
const path = require('path');

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logHistory = [];
const MAX_LOGS = 100;

class MemoryTransport extends winston.Transport {
    constructor(opts) {
        super(opts);
    }
    log(info, callback) {
        const msg = info.message || '';
        
        const isError = info.level === 'error' || info.level === 'warn';
        const isApiHit = msg.includes(' /api/') && !msg.includes(' /api/logs');
        const isAuthLog = msg.includes('Tokens') || msg.includes('Authentication') || msg.includes('Server listening');
        
        if (isError || isApiHit || isAuthLog) {
            logHistory.push({
                timestamp: info.timestamp || new Date().toISOString(),
                level: info.level,
                message: msg
            });
            if (logHistory.length > MAX_LOGS) {
                logHistory.shift();
            }
        }
        callback();
    }
}

const memoryTransport = new MemoryTransport();

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.Console(),
        memoryTransport
    ],
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
// Auth routes removed - handled natively by 3CX now
app.use('/api/smokeball', smokeballRoutes);
app.use('/api/3cx', tcxRoutes);

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve frontend dashboard for any other static assets if they exist
app.use(express.static('public'));

// Logs API endpoint for the GUI
app.get('/api/logs', async (req, res) => {
    res.json(logHistory);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(port, () => {
    logger.info(`Server listening on https://smokeball3cx-itt.vercel.app`);
    logger.info(`Install URL: https://smokeball3cx-itt.vercel.app/auth/install`);
});
