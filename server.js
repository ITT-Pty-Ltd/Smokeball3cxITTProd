require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const winston = require('winston');

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
        logHistory.push({
            timestamp: info.timestamp || new Date().toISOString(),
            level: info.level,
            message: info.message
        });
        if (logHistory.length > MAX_LOGS) {
            logHistory.shift();
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
const authRoutes = require('./src/routes/auth');
const smokeballRoutes = require('./src/routes/smokeball');
const tcxRoutes = require('./src/routes/3cx');

app.use('/auth', authRoutes);
app.use('/api/smokeball', smokeballRoutes);
app.use('/api/3cx', tcxRoutes);

// Root route – intercept OAuth callback before serving static files
const smokeballService = require('./src/services/smokeball');

app.get('/', async (req, res, next) => {
    const { code, error, error_description } = req.query;

    if (error) {
        logger.error('OAuth error:', error_description || error);
        return res.redirect(`/?auth=error&reason=${encodeURIComponent(error_description || error)}`);
    }

    // If there's a code param, this is the OAuth callback
    if (code) {
        try {
            await smokeballService.exchangeCodeForTokens(code);
            logger.info('Authentication successful – tokens stored.');
            return res.redirect('/?auth=success');
        } catch (err) {
            logger.error('Token exchange failed:', err.response?.data || err.message);
            const errMsg = err.response?.data?.error_description || err.message;
            return res.redirect(`/?auth=error&reason=${encodeURIComponent(errMsg)}`);
        }
    }

    // Otherwise pass to express.static to serve index.html
    next();
});

// Serve frontend dashboard
app.use(express.static('public'));

// Status API endpoint for the GUI
app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        authenticated: smokeballService.isAuthenticated(),
        installUrl: smokeballService.isAuthenticated() ? null : 'https://smokeball3cx-itt.vercel.app/auth/install',
    });
});

// Logs API endpoint for the GUI
app.get('/api/logs', (req, res) => {
    // Only return logs if authenticated (optional security measure)
    if (!smokeballService.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json(logHistory);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(port, () => {
    logger.info(`Server listening on https://smokeball3cx-itt.vercel.app`);
    logger.info(`Install URL: https://smokeball3cx-itt.vercel.app/auth/install`);
});
