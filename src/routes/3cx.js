const express = require('express');
const router = express.Router();
const smokeballService = require('../services/smokeball');
const winston = require('winston');
const axios = require('axios');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
});

const clientId = process.env.SMOKEBALL_CLIENT_ID;
const clientSecret = process.env.SMOKEBALL_CLIENT_SECRET;
const authUrl = process.env.SMOKEBALL_AUTH_URL || 'https://datastaging-auth.smokeball.com.au';
const APP_CALLBACK_URL = process.env.SMOKEBALL_REDIRECT_URI || 'https://smokeball3cx-itt.vercel.app/';

// Helper to extract Bearer token
function getAccessTokenFromReq(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }
    return null;
}

// ---------------------------------------------------------------------------
// Proxy Auth Endpoints (Stateless Auth for 3CX)
// ---------------------------------------------------------------------------

router.get('/oauth2/authorize', (req, res) => {
    const { response_type, client_id, redirect_uri, state, code_challenge } = req.query;

    if (!redirect_uri) {
        return res.status(400).send('Missing redirect_uri');
    }

    const statePayload = {
        pbxRedirect: redirect_uri,
        pbxState: state || ''
    };
    const b64State = Buffer.from(JSON.stringify(statePayload)).toString('base64');

    const params = new URLSearchParams({
        response_type: response_type || 'code',
        client_id: client_id || clientId,
        redirect_uri: APP_CALLBACK_URL, 
        state: b64State
    });

    if (code_challenge) {
        params.append('code_challenge', code_challenge);
    }

    const targetUrl = `${authUrl}/oauth2/authorize?${params.toString()}`;
    logger.info(`Proxying authorize request -> ${targetUrl}`);
    res.redirect(targetUrl);
});

router.post('/oauth2/token', async (req, res) => {
    const body = new URLSearchParams(req.body);

    logger.info('Received token proxy request from 3CX PBX', { grant_type: req.body.grant_type });

    if (body.has('redirect_uri')) {
        body.set('redirect_uri', APP_CALLBACK_URL);
    }
    
    const effectiveClientId = req.body.client_id || clientId;
    const effectiveClientSecret = req.body.client_secret || clientSecret;
    const basicAuth = Buffer.from(`${effectiveClientId}:${effectiveClientSecret}`).toString('base64');

    try {
        const response = await axios.post(`${authUrl}/oauth2/token`, body.toString(), {
            headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        res.json(response.data);
    } catch (err) {
        logger.error('Token proxy error:', err.response?.data || err.message);
        res.status(err.response?.status || 500).json(err.response?.data || { error: 'Token exchange failed' });
    }
});

// ---------------------------------------------------------------------------
// 3CX Logic Endpoints
// ---------------------------------------------------------------------------

router.get('/lookup', async (req, res) => {
    const { number } = req.query;
    const token = getAccessTokenFromReq(req);

    if (!token) {
        logger.warn('Missing access token in /lookup request');
        return res.status(401).json({ error: 'Missing access token in Authorization header.' });
    }

    if (!number) {
        return res.status(400).json({ error: 'Missing phone number.' });
    }

    logger.info(`3CX lookup for number: ${number}`);

    try {
        const contact = await smokeballService.searchContactByPhone(token, number);

        if (!contact) {
            logger.info(`No Smokeball contact found for ${number}`);
            return res.status(200).json({ contacts: [] });
        }

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
        res.json({ contacts: [result] });
    } catch (error) {
        logger.error('3CX lookup error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Lookup failed.' });
    }
});

router.post('/journal', (req, res) => {
    const token = getAccessTokenFromReq(req);
    if (!token) {
        logger.warn('Missing access token in /journal payload');
    }
    
    logger.info('3CX journal received', req.body);
    res.status(200).json({ status: 'received' });
});

module.exports = router;
