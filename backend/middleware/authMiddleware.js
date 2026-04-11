const admin = require('../config/firebaseAdmin');

const PRIMARY_ADMIN_EMAIL = 'onegapo2026@gmail.com';

function isPrimaryAdmin(user) {
  return (
    user &&
    user.role === 'admin' &&
    typeof user.email === 'string' &&
    user.email.toLowerCase() === PRIMARY_ADMIN_EMAIL
  );
}


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
  if (!isPrimaryAdmin(req.user)) {
    return res.status(403).json({
      error: 'Forbidden: Primary admin access required.',
    });
  }
  return next();
}

/**
 * Middleware: requireStaffOrAdmin
 * Must be used AFTER verifyToken.
 * Allows both staff and admin users.
 */
function requireStaffOrAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'staff' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Forbidden: Staff or Admin access required.' });
  }
  return next();
}

module.exports = { verifyToken, requireAdmin, requireStaffOrAdmin };
