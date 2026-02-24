const express = require('express');
const router = express.Router();
const smokeballService = require('../services/smokeball');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
});

/**
 * GET /auth/install
 * Redirects the user to Smokeball's OAuth2 authorize page.
 * This is the "installation URL" users visit to connect their account.
 */
router.get('/install', (req, res) => {
    const url = smokeballService.getInstallUrl();
    logger.info(`Redirecting user to Smokeball authorize URL: ${url}`);
    res.redirect(url);
});

/**
 * GET /auth/callback
 * Smokeball redirects back here with ?code=xxxxx after the user logs in.
 * We exchange the code for access + refresh tokens.
 */
router.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        logger.error('Callback received without authorization code.');
        return res.status(400).json({ error: 'Missing authorization code.' });
    }

    try {
        const tokenData = await smokeballService.exchangeCodeForTokens(code);
        logger.info('Authentication successful – tokens stored.');
        res.json({
            message: 'Authentication successful! You can now use the API.',
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in,
        });
    } catch (error) {
        logger.error('Token exchange failed:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to exchange code for tokens.',
            details: error.response?.data || error.message,
        });
    }
});

/**
 * GET /auth/status
 * Quick check whether the server currently holds valid tokens.
 */
router.get('/status', (req, res) => {
    res.json({
        authenticated: smokeballService.isAuthenticated(),
        installUrl: smokeballService.isAuthenticated() ? null : smokeballService.getInstallUrl(),
    });
});

module.exports = router;
