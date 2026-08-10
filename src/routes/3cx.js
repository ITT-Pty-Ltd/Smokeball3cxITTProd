const express = require('express');
const router = express.Router();
const axios = require('axios');
const config = require('../config');
const smokeballService = require('../services/smokeball');
const { getAccessTokenFromReq } = require('../utils/auth');
const contactCache = require('../utils/contactCache');
const { formatContactFor3cx } = require('../utils/contactFormat');
const { renderContactPage, renderNotFoundPage } = require('../utils/contactPage');
const { processCallJournal, processChatJournal } = require('../services/journalProcessor');
const { formatApiError } = require('../utils/formatApiError');
const { logger } = require('../logger');

const {
    clientId,
    clientSecret,
    authBaseUrl,
    redirectUri: appCallbackUrl,
    oauthMode,
} = config.smokeball;

function to3cxContact(contact, dialNumber) {
    const result = {
        ...formatContactFor3cx(contact, dialNumber),
        contactUrl: smokeballService.buildContactOpenUrl(contact.id),
    };
    contactCache.set(contact.id, result);
    return result;
}

// ---------------------------------------------------------------------------
// Proxy Auth Endpoints (Stateless Auth for 3CX)
// ---------------------------------------------------------------------------

router.get('/oauth2/authorize', (req, res) => {
    const { response_type, client_id, redirect_uri, state, code_challenge } = req.query;

    if (!redirect_uri) {
        return res.status(400).send('Missing redirect_uri');
    }

    let smokeballRedirectUri = redirect_uri;
    let smokeballState = state || '';

    if (oauthMode === 'proxy') {
        const statePayload = {
            pbxRedirect: redirect_uri,
            pbxState: state || '',
        };
        smokeballRedirectUri = appCallbackUrl;
        smokeballState = Buffer.from(JSON.stringify(statePayload)).toString('base64');
    }

    const params = new URLSearchParams({
        response_type: response_type || 'code',
        client_id: client_id || clientId,
        redirect_uri: smokeballRedirectUri,
        state: smokeballState,
    });

    if (code_challenge) {
        params.append('code_challenge', code_challenge);
        params.append('code_challenge_method', 'S256');
    }

    const targetUrl = `${authBaseUrl}/oauth2/authorize?${params.toString()}`;
    logger.info(
        `OAuth authorize (${oauthMode}): 3CX redirect=${redirect_uri} -> Smokeball redirect=${smokeballRedirectUri}`
    );
    res.redirect(targetUrl);
});

router.post('/oauth2/token', async (req, res) => {
    const body = new URLSearchParams(req.body);

    logger.info('Received token proxy request from 3CX PBX', { grant_type: req.body.grant_type });

    if (oauthMode === 'proxy' && body.has('redirect_uri')) {
        logger.info(`OAuth token (${oauthMode}): rewriting redirect_uri to ${appCallbackUrl}`);
        body.set('redirect_uri', appCallbackUrl);
    }

    const effectiveClientId = req.body.client_id || clientId;
    const effectiveClientSecret = req.body.client_secret || clientSecret;
    const basicAuth = Buffer.from(`${effectiveClientId}:${effectiveClientSecret}`).toString('base64');

    try {
        const response = await axios.post(`${authBaseUrl}/oauth2/token`, body.toString(), {
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
    const { number, email } = req.query;
    const token = getAccessTokenFromReq(req);

    if (!token) {
        logger.warn('Missing access token in /lookup request');
        return res.status(401).json({ error: 'Missing access token in Authorization header.' });
    }

    if (!number && !email) {
        return res.status(400).json({ error: 'Missing phone number or email.' });
    }

    try {
        let contact = null;
        if (email) {
            logger.info(`3CX lookup for email: ${email}`);
            contact = await smokeballService.searchContactByEmail(token, email);
        } else {
            logger.info(`3CX lookup for number: ${number}`);
            contact = await smokeballService.searchContactByPhone(token, number);
        }

        if (!contact) {
            logger.info(`No Smokeball contact found for ${email || number}`);
            return res.status(200).json({ contacts: [] });
        }

        const result = to3cxContact(contact, number || undefined);
        const displayName =
            result.company ||
            [result.firstName, result.lastName].filter(Boolean).join(' ') ||
            'Unknown';
        logger.info(`Match found: ${displayName} (id=${result.id})`);
        res.json({ contacts: [result] });
    } catch (error) {
        logger.error('3CX lookup error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Lookup failed.',
            details: error.response?.data || error.message,
        });
    }
});

/**
 * Free-text search for 3CX SearchContacts (name, number, or email).
 * GET /api/3cx/search?q=
 */
router.get('/search', async (req, res) => {
    const q = req.query.q || req.query.search || req.query.SearchText || '';
    const token = getAccessTokenFromReq(req);

    if (!token) {
        logger.warn('Missing access token in /search request');
        return res.status(401).json({ error: 'Missing access token in Authorization header.' });
    }

    if (!String(q).trim()) {
        return res.status(400).json({ error: 'Missing search query.' });
    }

    logger.info(`3CX search: ${q}`);

    try {
        const found = await smokeballService.searchContactsByText(token, q, 10);
        const contacts = found.map((c) => to3cxContact(c));
        logger.info(`3CX search returned ${contacts.length} contact(s)`);
        res.json({ contacts });
    } catch (error) {
        logger.error('3CX search error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Search failed.',
            details: error.response?.data || error.message,
        });
    }
});

/** Browser-friendly contact card (no Smokeball auth required). Populated during lookup/search. */
router.get('/contacts/:id/open', (req, res) => {
    const cached = contactCache.get(req.params.id);
    if (!cached) {
        return res.status(404).type('html').send(renderNotFoundPage());
    }
    res.type('html').send(renderContactPage(cached, config.smokeball.appUrl));
});

router.post('/journal', async (req, res) => {
    const token = getAccessTokenFromReq(req);
    if (!token) {
        logger.warn('Missing access token in /journal request');
        return res.status(401).json({ error: 'Missing access token in Authorization header.' });
    }

    logger.info('3CX journal received', req.body);

    try {
        const result = await processCallJournal(token, req.body);
        if (result.status === 'failed') {
            return res.status(422).json(result);
        }
        res.status(200).json(result);
    } catch (error) {
        const details = formatApiError(error);
        logger.error(`3CX journal error: ${details}`);
        res.status(error.response?.status || 500).json({
            error: 'Journal processing failed.',
            details,
        });
    }
});

router.post('/chat-journal', async (req, res) => {
    const token = getAccessTokenFromReq(req);
    if (!token) {
        logger.warn('Missing access token in /chat-journal request');
        return res.status(401).json({ error: 'Missing access token in Authorization header.' });
    }

    logger.info('3CX chat journal received', req.body);

    try {
        const result = await processChatJournal(token, req.body);
        if (result.status === 'failed') {
            return res.status(422).json(result);
        }
        res.status(200).json(result);
    } catch (error) {
        const details = formatApiError(error);
        logger.error(`3CX chat journal error: ${details}`);
        res.status(error.response?.status || 500).json({
            error: 'Chat journal processing failed.',
            details,
        });
    }
});

module.exports = router;
