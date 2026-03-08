const admin = require('../config/firebaseAdmin');

/**
 * Middleware: verifyToken
 * Validates the Firebase ID token from the Authorization header.
 * On success, attaches the decoded token payload to `req.user`.
 */
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed token.' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
  }
}

/**
 * Middleware: requireAdmin
 * Must be used AFTER verifyToken.
 * Blocks the request if the authenticated user does not hold the 'admin' custom claim.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required.' });
  }
  return next();
}

module.exports = { verifyToken, requireAdmin };
