require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const winston = require('winston');

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
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

// Root route – handles the OAuth callback (Smokeball redirects here with ?code=xxx)
const smokeballService = require('./src/services/smokeball');
app.get('/', async (req, res) => {
    const { code } = req.query;

    // If there's a code param, this is the OAuth callback
    if (code) {
        try {
            const tokenData = await smokeballService.exchangeCodeForTokens(code);
            logger.info('Authentication successful – tokens stored.');
            return res.json({
                message: 'Authentication successful! You can now use the API.',
                token_type: tokenData.token_type,
                expires_in: tokenData.expires_in,
            });
        } catch (error) {
            logger.error('Token exchange failed:', error.response?.data || error.message);
            return res.status(500).json({
                error: 'Failed to exchange code for tokens.',
                details: error.response?.data || error.message,
            });
        }
    }

    // Otherwise show status
    res.json({
        status: 'Cloud Chat Integration is running.',
        authenticated: smokeballService.isAuthenticated(),
        installUrl: smokeballService.isAuthenticated() ? null : `http://localhost:${port}/auth/install`,
    });
});

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', message: 'Cloud Chat Integration is running.' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(port, () => {
    logger.info(`Server listening on http://localhost:${port}`);
    logger.info(`Install URL: http://localhost:${port}/auth/install`);
});
