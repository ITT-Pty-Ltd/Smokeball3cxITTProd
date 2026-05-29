const express = require('express');
const router = express.Router();
const axios = require('axios');
const config = require('../config');
const smokeballService = require('../services/smokeball');
const { getAccessTokenFromReq } = require('../utils/auth');
const { logger } = require('../logger');

const {
    clientId,
    clientSecret,
    authBaseUrl,
    redirectUri: appCallbackUrl,
    oauthMode,
} = config.smokeball;

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
            // 3CX opens ContactUrl in the browser — must be the web app, not the REST API.
            contactUrl: smokeballService.buildContactWebUrl(contact.id),
        };

        logger.info(`Match found: ${result.firstName} ${result.lastName}`);
        res.json({ contacts: [result] });
    } catch (error) {
        logger.error('3CX lookup error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'Lookup failed.',
            details: error.response?.data || error.message,
        });
    }
});

router.post('/journal', (req, res) => {
    const token = getAccessTokenFromReq(req);
    if (!token) {
        logger.warn('Missing access token in /journal request');
        return res.status(401).json({ error: 'Missing access token in Authorization header.' });
    }

    logger.info('3CX journal received', req.body);
    res.status(200).json({ status: 'received' });
});

module.exports = router;
