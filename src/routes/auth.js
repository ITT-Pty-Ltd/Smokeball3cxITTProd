const express = require('express');
const router = express.Router();

/**
 * GET /auth/install
 * Native installation is handled directly by the 3CX PBX.
 */
router.get('/install', (req, res) => {
    res.send(
        'Native installation is handled directly within your 3CX PBX. ' +
            'Please load the XML Template into your 3CX Server to authenticate natively.'
    );
});

/**
 * GET /auth/status
 */
router.get('/status', (req, res) => {
    res.json({
        authenticated: true,
        installUrl: null,
        mode: 'stateless proxy',
    });
});

module.exports = router;
