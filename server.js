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
        const isAuthLog = msg.includes('Tokens') || msg.includes('Authentication') || msg.includes('Server listening') || msg.includes('Stateless');
        
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
const authRoutes = require('./src/routes/auth');
const smokeballRoutes = require('./src/routes/smokeball');
const tcxRoutes = require('./src/routes/3cx');

app.use('/auth', authRoutes);
app.use('/api/smokeball', smokeballRoutes);
app.use('/api/3cx', tcxRoutes);

// Root route – intercept OAuth callback before serving static files
app.get('/', async (req, res, next) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
        logger.error('OAuth error:', error_description || error);
        return res.redirect(`/?auth=error&reason=${encodeURIComponent(error_description || error)}`);
    }

    if (code) {
        // Intercept 3CX PBX stateless OAuth flow
        if (state) {
            try {
                const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));
                if (decodedState.pbxRedirect) {
                    const pbxUrl = new URL(decodedState.pbxRedirect);
                    pbxUrl.searchParams.append('code', code);
                    if (decodedState.pbxState) {
                        pbxUrl.searchParams.append('state', decodedState.pbxState);
                    }
                    logger.info(`Stateless OAuth proxy: Redirecting browser back to PBX -> ${pbxUrl.toString()}`);
                    return res.redirect(pbxUrl.toString());
                }
            } catch (e) {
                // Not a valid JSON base64 state, ignore
            }
        }
        
        // Old stateful handle fallback (informative only)
        return res.redirect('/?auth=success_but_stateless');
    }

    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve frontend dashboard for any other static assets if they exist
app.use(express.static('public'));

// Status API endpoint for the GUI
app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        authenticated: true, // Always true since PBX handles auth individually
        installUrl: null,
        message: 'Stateless Proxy Active - Native 3CX Authentication'
    });
});

// Logs API endpoint for the GUI
app.get('/api/logs', (req, res) => {
    res.json(logHistory);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(port, () => {
    logger.info(`Server listening on https://smokeball3cx-itt.vercel.app`);
    logger.info(`Stateless Proxy Active. Load the XML template directly into the 3CX PBX.`);
});
