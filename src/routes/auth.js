const express = require('express');
const router = express.Router();
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
});

/**
 * GET /auth/install
 * Native installation is now handled directly by the 3CX PBX. 
 * This route just informs users who accidentally visit the old link.
 */
router.get('/install', (req, res) => {
    res.send('Native installation is handled directly within your 3CX PBX. Please load the XML Template into your 3CX Server to authenticate natively.');
});

/**
 * GET /auth/status
 * Just reports stateless mode
 */
router.get('/status', (req, res) => {
    res.json({
        authenticated: true,
        installUrl: null,
        mode: 'stateless proxy'
    });
});

module.exports = router;
