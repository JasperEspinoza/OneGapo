const admin = require('../config/firebaseAdmin');

const ALLOWED_ROLES = ['staff', 'admin'];
const ALLOWED_PERMISSIONS = ['view_reports', 'update_reports', 'close_reports', 'create_announcements'];

// Basic email regex — prevents obviously malformed addresses from reaching Firebase
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/create-staff
 *
 * Creates a new Firebase Auth user tagged to a branch, assigns Custom Claims
 * (role, branchId, location, entityType, permissions), and writes a Firestore user doc.
 *
 * Request body:
 *   - email       {string}   The new user's email address.
 *   - password    {string}   Minimum 8 characters.
 *   - role        {string}   Either "staff" or "admin".
 *   - branchId    {string}   Firestore document ID of the branch.
 *   - permissions {string[]} Subset of ALLOWED_PERMISSIONS.
 *
 * Protected: verifyToken + requireAdmin middleware must run first.
 */
async function createStaff(req, res, next) {
  try {
    const { email, password, role, branchId, permissions = [] } = req.body;

    // --- Input validation ---
    if (!email || !password || !role || !branchId) {
      return res.status(400).json({
        error: 'Missing required fields: email, password, role, and branchId are all required.',
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Allowed values are: ${ALLOWED_ROLES.join(', ')}.`,
      });
    }

    // Sanitise permissions — silently drop any unknown values
    const sanitizedPerms = permissions.filter((p) => ALLOWED_PERMISSIONS.includes(p));

    // --- Resolve branch ---
    const db = admin.firestore();
    const branchSnap = await db.collection('branches').doc(branchId).get();
    if (!branchSnap.exists) {
      return res.status(404).json({ error: 'Branch not found.' });
    }
    const branch = branchSnap.data();

    // --- Create the Firebase Auth user ---
    const userRecord = await admin.auth().createUser({
      email:         email.toLowerCase().trim(),
      password,
      emailVerified: false,
    });

    // --- Assign Custom Claims (role + location context + permissions) ---
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role,
      branchId,
      location:   branch.name,
      entityType: branch.type,
      permissions: sanitizedPerms,
    });

    // --- Write Firestore user document ---
    await db.collection('users').doc(userRecord.uid).set({
      uid:         userRecord.uid,
      fullName:    '',
      email:       email.toLowerCase().trim(),
      role,
      branchId,
      branchName:  branch.name,
      entityType:  branch.type,
      permissions: sanitizedPerms,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      createdBy:   req.user.uid,
    });

    return res.status(201).json({
      message:    'Staff account created successfully.',
      uid:        userRecord.uid,
      email:      userRecord.email,
      role,
      branchId,
      location:   branch.name,
      entityType: branch.type,
      permissions: sanitizedPerms,
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'A user with this email address already exists.' });
    }
    if (err.code === 'auth/invalid-email') {
      return res.status(400).json({ error: 'The email address is invalid.' });
    }
    if (err.code === 'auth/invalid-password') {
      return res.status(400).json({ error: 'The password does not meet Firebase requirements.' });
    }
    return next(err);
  }
}

/**
 * GET /api/admin/users
 * Returns all user documents from Firestore, ordered by creation date (newest first).
 */
async function listUsers(req, res, next) {
  try {
    const snap = await admin
      .firestore()
      .collection('users')
      .orderBy('createdAt', 'desc')
      .get();

    const users = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        uid:         d.uid,
        fullName:    d.fullName  || '',
        email:       d.email     || '',
        role:        d.role      || '',
        branchId:    d.branchId  || null,
        branchName:  d.branchName || null,
        entityType:  d.entityType || null,
        permissions: d.permissions || [],
        createdAt:   d.createdAt ? d.createdAt.toDate().toISOString() : null,
      };
    });

    return res.json(users);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/admin/users/:uid
 *
 * Updates a provisioned staff or admin account's role, branch assignment,
 * and/or permissions. Merges updated fields into existing Custom Claims.
 *
 * Request body (all fields optional; omit to leave unchanged):
 *   - role        {string}   'staff' or 'admin'
 *   - branchId    {string}   Firestore branch document ID
 *   - permissions {string[]} Replacement permission set
 *
 * Protected: verifyToken + requireAdmin middleware must run first.
 */
async function updateStaff(req, res, next) {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid is required.' });

    const { role, branchId, permissions } = req.body;

    const firestoreUpdates = {};
    const claimUpdates     = {};

    if (role !== undefined) {
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          error: `Invalid role. Allowed values are: ${ALLOWED_ROLES.join(', ')}.`,
        });
      }
      firestoreUpdates.role = role;
      claimUpdates.role     = role;
    }

    const db = admin.firestore();

    if (branchId !== undefined) {
      const branchSnap = await db.collection('branches').doc(branchId).get();
      if (!branchSnap.exists) {
        return res.status(404).json({ error: 'Branch not found.' });
      }
      const branch = branchSnap.data();
      firestoreUpdates.branchId   = branchId;
      firestoreUpdates.branchName = branch.name;
      firestoreUpdates.entityType = branch.type;
      claimUpdates.branchId   = branchId;
      claimUpdates.location   = branch.name;
      claimUpdates.entityType = branch.type;
    }

    if (permissions !== undefined) {
      const sanitized = permissions.filter((p) => ALLOWED_PERMISSIONS.includes(p));
      firestoreUpdates.permissions = sanitized;
      claimUpdates.permissions     = sanitized;
    }

    if (Object.keys(claimUpdates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    // Retrieve current claims and merge so unrelated claims are preserved
    const userRecord   = await admin.auth().getUser(uid);
    const currentClaims = userRecord.customClaims || {};
    await admin.auth().setCustomUserClaims(uid, { ...currentClaims, ...claimUpdates });

    firestoreUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    firestoreUpdates.updatedBy = req.user.uid;
    await db.collection('users').doc(uid).update(firestoreUpdates);

    return res.json({
      message: 'Account updated successfully.',
      uid,
      ...firestoreUpdates,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found in Firebase Auth.' });
    }
    return next(err);
  }
}

/**
 * DELETE /api/admin/users/:uid
 *
 * Permanently removes a user's Firebase Auth record and Firestore document.
 * Admins cannot delete their own account.
 *
 * Protected: verifyToken + requireAdmin middleware must run first.
 */
async function deleteUser(req, res, next) {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid is required.' });

    if (uid === req.user.uid) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    // Delete Auth record first; if it's already gone, still clean up Firestore
    try {
      await admin.auth().deleteUser(uid);
    } catch (authErr) {
      if (authErr.code !== 'auth/user-not-found') return next(authErr);
    }

    await admin.firestore().collection('users').doc(uid).delete();

    return res.json({ message: 'User deleted.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createStaff, listUsers, updateStaff, deleteUser };

