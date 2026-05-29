const express = require('express');
const router = express.Router();
const smokeballService = require('../services/smokeball');
const { requireAccessToken } = require('../utils/auth');
const { logger } = require('../logger');

router.use(requireAccessToken);

/**
 * GET /api/smokeball/contacts
 * Fetch contacts from Smokeball (paginated).
 */
router.get('/contacts', async (req, res) => {
    try {
        const offset = parseInt(req.query.offset, 10) || 0;
        const limit = parseInt(req.query.limit, 10) || 500;
        const data = await smokeballService.fetchContacts(req.accessToken, offset, limit);
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
 * GET /api/smokeball/contacts/search?phone=
 * Search contacts by phone number (same logic as 3CX lookup).
 */
router.get('/contacts/search', async (req, res) => {
    const { phone } = req.query;
    if (!phone) {
        return res.status(400).json({ error: 'Missing phone query parameter.' });
    }

    try {
        const contact = await smokeballService.searchContactByPhone(req.accessToken, phone);
        res.json({ contact });
    } catch (error) {
        logger.error('Error searching contacts:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to search contacts.',
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
        const data = await smokeballService.fetchContactById(req.accessToken, req.params.id);
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
