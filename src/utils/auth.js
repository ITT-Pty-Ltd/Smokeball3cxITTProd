function getAccessTokenFromReq(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    return null;
}

function requireAccessToken(req, res, next) {
    const token = getAccessTokenFromReq(req);
    if (!token) {
        return res.status(401).json({ error: 'Missing access token in Authorization header.' });
    }
    req.accessToken = token;
    next();
}

module.exports = { getAccessTokenFromReq, requireAccessToken };
