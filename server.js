require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const config = require('./src/config');
const { logger, getLogHistory } = require('./src/logger');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

const authRoutes = require('./src/routes/auth');
const smokeballRoutes = require('./src/routes/smokeball');
const tcxRoutes = require('./src/routes/3cx');

app.use('/auth', authRoutes);
app.use('/api/smokeball', smokeballRoutes);
app.use('/api/3cx', tcxRoutes);

/** Legacy paths used by older 3CX CRM templates (before /api/3cx prefix). */
function forwardTo3cx(subpath) {
    return (req, res, next) => {
        const query = Object.keys(req.query).length
            ? `?${new URLSearchParams(req.query).toString()}`
            : '';
        req.url = `${subpath}${query}`;
        tcxRoutes(req, res, next);
    };
}

app.get('/lookup', forwardTo3cx('/lookup'));
app.post('/journal', forwardTo3cx('/journal'));

app.get(['/', '/auth/callback'], async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
        logger.error('OAuth error:', error_description || error);
        return res.redirect(`/?auth=error&reason=${encodeURIComponent(error_description || error)}`);
    }

    if (code) {
        if (state) {
            try {
                const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));
                if (decodedState.pbxRedirect) {
                    const pbxUrl = new URL(decodedState.pbxRedirect);
                    pbxUrl.searchParams.append('code', code);
                    if (decodedState.pbxState) {
                        pbxUrl.searchParams.append('state', decodedState.pbxState);
                    }
                    logger.info(`Stateless OAuth proxy: redirecting browser back to PBX -> ${pbxUrl.toString()}`);
                    return res.redirect(pbxUrl.toString());
                }
            } catch {
                // Not a valid base64 JSON state payload
            }
        }

        return res.redirect('/?auth=success');
    }

    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static('public'));

app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        authenticated: true,
        installUrl: null,
        message: 'Stateless Proxy Active - Native 3CX Authentication',
    });
});

app.get('/api/logs', (req, res) => {
    res.json(getLogHistory());
});

if (require.main === module) {
    app.listen(config.port, () => {
        logger.info(`Server listening on ${config.publicUrl}`);
        logger.info('Stateless Proxy Active. Load the XML template directly into the 3CX PBX.');
    });
}

module.exports = app;
