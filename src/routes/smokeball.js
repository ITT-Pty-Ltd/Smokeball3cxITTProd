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
 * GET /api/smokeball/contacts
 * Fetch contacts from Smokeball (paginated).
 */
router.get('/contacts', async (req, res) => {
    try {
        const offset = parseInt(req.query.offset, 10) || 0;
        const limit = parseInt(req.query.limit, 10) || 500;
        const data = await smokeballService.fetchContacts(offset, limit);
        res.json(data);
    } catch (error) {
        logger.error('Error fetching contacts:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch contacts.',
            details: error.response?.data || error.message,
        });
    }
});

/**
 * GET /api/smokeball/contacts/:id
 * Fetch a single contact by ID.
 */
router.get('/contacts/:id', async (req, res) => {
    try {
        const data = await smokeballService.fetchContactById(req.params.id);
        res.json(data);
    } catch (error) {
        logger.error('Error fetching contact:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch contact.',
            details: error.response?.data || error.message,
        });
    }
});

module.exports = router;
