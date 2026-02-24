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
 * GET /api/3cx/lookup?number=0412345678
 * Called by the 3CX CRM template to look up a caller by phone number.
 */
router.get('/lookup', async (req, res) => {
    const { number } = req.query;

    if (!number) {
        return res.status(400).json({ error: 'Missing phone number.' });
    }

    logger.info(`3CX lookup for number: ${number}`);

    try {
        const contact = await smokeballService.searchContactByPhone(number);

        if (!contact) {
            logger.info(`No Smokeball contact found for ${number}`);
            return res.status(200).json([]);
        }

        // Build a response the 3CX template variables can map to.
        const person = contact.person || {};
        const company = contact.company || {};

        const result = {
            id: contact.id,
            firstName: person.firstName || '',
            lastName: person.lastName || company.name || 'Unknown',
            company: company.name || '',
            phone: number,
            email: person.email || company.email || '',
            contactUrl: `${smokeballService.apiUrl}/contacts/${contact.id}`,
        };

        logger.info(`Match found: ${result.firstName} ${result.lastName}`);
        res.json(result);
    } catch (error) {
        logger.error('3CX lookup error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Lookup failed.' });
    }
});

/**
 * POST /api/3cx/journal
 * Called by 3CX after a call ends to journal call details.
 */
router.post('/journal', (req, res) => {
    logger.info('3CX journal received', req.body);

    // Acknowledge immediately so 3CX doesn't time out.
    res.status(200).json({ status: 'received' });
});

module.exports = router;
