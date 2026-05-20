const admin = require('../config/firebaseAdmin');

const PRIMARY_ADMIN_EMAIL = 'onegapo2026@gmail.com';
let cachedPrimaryAdminUid = null;
let primaryAdminUidLookupAttempted = false;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeRoleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getEffectiveRoleKey(user = {}) {
  const roleKey = normalizeRoleKey(user.role);
  const customRoleKey = normalizeRoleKey(user.customRoleName);

  if (roleKey === 'responder' || customRoleKey === 'responder') {
    return 'responder';
  }

  return roleKey || customRoleKey || '';
}

async function getPrimaryAdminUid() {
  if (cachedPrimaryAdminUid) return cachedPrimaryAdminUid;
  if (primaryAdminUidLookupAttempted) return null;

  primaryAdminUidLookupAttempted = true;

  try {
    const userRecord = await admin.auth().getUserByEmail(PRIMARY_ADMIN_EMAIL);
    cachedPrimaryAdminUid = userRecord?.uid || null;
    return cachedPrimaryAdminUid;
  } catch {
    return null;
  }
}

function isAdminRole(user) {
  return getEffectiveRoleKey(user) === 'admin';
}

function isPrimaryAdmin(user) {
  if (user?.isPrimaryAdmin === true) return true;
  return normalizeEmail(user?.email) === normalizeEmail(PRIMARY_ADMIN_EMAIL);
}

function hasPermission(user, permission) {
  if (!permission) return false;
  if (isPrimaryAdmin(user) || isAdminRole(user)) return true;
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes(permission);
}

function hasAnyPermission(user, permissions = []) {
  if (isPrimaryAdmin(user) || isAdminRole(user)) return true;
  if (!Array.isArray(permissions) || permissions.length === 0) return false;
  return permissions.some((permission) => hasPermission(user, permission));
}


async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed token.' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const primaryAdminUid = await getPrimaryAdminUid();

    let hydratedToken = decodedToken;
    if (!decodedToken.email && decodedToken.uid) {
      try {
        const userRecord = await admin.auth().getUser(decodedToken.uid);
        hydratedToken = {
          ...decodedToken,
          email: userRecord?.email || '',
        };
      } catch {
        hydratedToken = decodedToken;
      }
    }

    const tokenEmail =
      hydratedToken.email ||
      decodedToken.email ||
      decodedToken?.firebase?.identities?.email?.[0] ||
      '';

    const profileOverlay = {};

    if (decodedToken.uid) {
      try {
        const userSnap = await admin.firestore().collection('users').doc(decodedToken.uid).get();
        if (userSnap.exists) {
          const userData = userSnap.data() || {};
          profileOverlay.fullName = userData.fullName || hydratedToken.fullName || '';
          profileOverlay.branchName = userData.branchName || hydratedToken.branchName || hydratedToken.location || null;
          profileOverlay.customRoleId = userData.customRoleId || hydratedToken.customRoleId || null;
          profileOverlay.customRoleName = userData.customRoleName || hydratedToken.customRoleName || null;
          profileOverlay.phone = userData.phone || hydratedToken.phone || null;
          profileOverlay.address = userData.address || hydratedToken.address || null;
          profileOverlay.verified = Boolean(userData.verified === true || hydratedToken.verified === true);
        }
      } catch {
        // Continue with token claims if the profile lookup fails.
      }
    }

    const tokenIsPrimaryAdmin =
      normalizeEmail(tokenEmail) === normalizeEmail(PRIMARY_ADMIN_EMAIL) ||
      Boolean(primaryAdminUid && decodedToken.uid === primaryAdminUid);

    req.user = {
      ...hydratedToken,
      ...profileOverlay,
      roleKey: getEffectiveRoleKey({ ...hydratedToken, ...profileOverlay }),
      email: tokenEmail,
      isPrimaryAdmin: tokenIsPrimaryAdmin,
    };
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
  if (!isAdminRole(req.user) && !isPrimaryAdmin(req.user)) {
    return res.status(403).json({
      error: 'Forbidden: Admin access required.',
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
  const roleKey = getEffectiveRoleKey(req.user);
  if (
    !req.user ||
    ((roleKey !== 'staff' && roleKey !== 'admin') && !isPrimaryAdmin(req.user))
  ) {
    return res.status(403).json({ error: 'Forbidden: Staff or Admin access required.' });
  }
  return next();
}

function requirePermission(permission) {
  return function permissionMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({
        error: `Forbidden: Missing required permission ${permission}.`,
      });
    }

    return next();
  };
}

function requireAnyPermission(permissions = []) {
  return function anyPermissionMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    if (!hasAnyPermission(req.user, permissions)) {
      return res.status(403).json({
        error: 'Forbidden: Missing required permissions.',
      });
    }

    return next();
  };
}

module.exports = {
  verifyToken,
  requireAdmin,
  requireStaffOrAdmin,
  requirePermission,
  requireAnyPermission,
  hasPermission,
  hasAnyPermission,
};
