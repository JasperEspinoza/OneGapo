const admin = require('../config/firebaseAdmin');
const {
  sendPasswordResetEmail,
  summarizeEmailDeliveries,
} = require('../services/emailService');
const {
  getVerificationStatus,
  sendAccountVerificationEmail,
} = require('../services/verificationService');
const {
  ALLOWED_ROLES,
  sanitizePermissions,
} = require('../constants/rbac');
const PRIMARY_ADMIN_EMAIL = 'onegapo2026@gmail.com';

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
 *   - customRoleId {string?} Firestore role document ID; permissions are inherited from this role.
 *
 * Protected: verifyToken + requireAdmin middleware must run first.
 */
async function createStaff(req, res, next) {
  try {
    const { email, password, role, branchId, customRoleId } = req.body;
    const normalizedEmail = String(email || '').toLowerCase().trim();

    // --- Input validation ---
    if (!email || !password || !role) {
      return res.status(400).json({
        error: 'Missing required fields: email, password, and role are all required.',
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

    if (role === 'admin' && normalizedEmail !== PRIMARY_ADMIN_EMAIL) {
      return res.status(403).json({
        error: `The admin dashboard is reserved for ${PRIMARY_ADMIN_EMAIL} only.`,
      });
    }

    // --- Resolve role permissions ---
    const db = admin.firestore();
    let sanitizedPerms = [];
    let customRoleName = null;

    if (customRoleId) {
      const roleSnap = await db.collection('roles').doc(customRoleId).get();
      if (!roleSnap.exists) {
        return res.status(404).json({ error: 'Custom role not found.' });
      }
      const roleData = roleSnap.data();
      sanitizedPerms = sanitizePermissions(roleData.permissions || []);
      customRoleName = roleData.name;
    }

    // --- Optionally resolve branch ---
    let branch = null;
    if (branchId) {
      const branchSnap = await db.collection('branches').doc(branchId).get();
      if (!branchSnap.exists) {
        return res.status(404).json({ error: 'Branch not found.' });
      }
      branch = branchSnap.data();
    }

    // --- Create the Firebase Auth user ---
    const userRecord = await admin.auth().createUser({
      email:         normalizedEmail,
      password,
      emailVerified: false,
    });

    // --- Assign Custom Claims (role + location context + permissions) ---
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role,
      branchId:    branchId || null,
      location:    branch ? branch.name : null,
      entityType:  branch ? branch.type : null,
      permissions: sanitizedPerms,
      verified:    false,
    });

    // --- Write Firestore user document ---
    await db.collection('users').doc(userRecord.uid).set({
      uid:         userRecord.uid,
      fullName:    '',
      email:       normalizedEmail,
      role,
      branchId:       branchId || null,
      branchName:     branch ? branch.name : null,
      entityType:     branch ? branch.type : null,
      customRoleId:   customRoleId || null,
      customRoleName: customRoleName || null,
      permissions:    sanitizedPerms,
      verified:       false,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      createdBy:   req.user.uid,
    });

    // Send verification and password reset emails
    try {
      await sendAccountVerificationEmail(userRecord.uid, userRecord.email, {
        branchName: branch ? branch.name : null,
      });
    } catch (emailErr) {
      console.warn('Failed to send verification email, but account was created. Admin can resend manually.', emailErr.message);
    }

    return res.status(201).json({
      message:    'Staff account created successfully. Verification email sent.',
      uid:        userRecord.uid,
      email:      userRecord.email,
      role,
      branchId:       branchId || null,
      location:       branch ? branch.name : null,
      entityType:     branch ? branch.type : null,
      customRoleId:   customRoleId || null,
      customRoleName: customRoleName || null,
      permissions:    sanitizedPerms,
      verified:       false,
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

    const docsData = snap.docs.map((doc) => doc.data());

    const users = docsData.map((d) => ({
      uid:         d.uid,
      fullName:    d.fullName  || '',
      email:       d.email     || '',
      role:        d.role      || '',
      branchId:    d.branchId  || null,
      branchName:  d.branchName || null,
      entityType:  d.entityType || null,
      customRoleId:   d.customRoleId || null,
      customRoleName: d.customRoleName || null,
      permissions: d.permissions || [],
      verified:    d.verified === true,
      createdAt:   d.createdAt ? d.createdAt.toDate().toISOString() : null,
    }));

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
 *   - customRoleId {string?} Firestore role document ID; updates inherited permissions
 *
 * Protected: verifyToken + requireAdmin middleware must run first.
 */
async function updateStaff(req, res, next) {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid is required.' });

    const { role, branchId, customRoleId } = req.body;

    const firestoreUpdates = {};
    const claimUpdates     = {};

    if (role !== undefined) {
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          error: `Invalid role. Allowed values are: ${ALLOWED_ROLES.join(', ')}.`,
        });
      }

      const targetUserRecord = await admin.auth().getUser(uid);
      if (role === 'admin' && targetUserRecord.email?.toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
        return res.status(403).json({
          error: `Only ${PRIMARY_ADMIN_EMAIL} can hold admin access.`,
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

    if (customRoleId !== undefined) {
      if (customRoleId) {
        const roleSnap = await db.collection('roles').doc(customRoleId).get();
        if (!roleSnap.exists) {
          return res.status(404).json({ error: 'Custom role not found.' });
        }
        const roleData = roleSnap.data();
        const sanitized = sanitizePermissions(roleData.permissions || []);
        firestoreUpdates.customRoleId   = customRoleId;
        firestoreUpdates.customRoleName = roleData.name;
        firestoreUpdates.permissions    = sanitized;
        claimUpdates.permissions        = sanitized;
      } else {
        firestoreUpdates.customRoleId   = null;
        firestoreUpdates.customRoleName = null;
        firestoreUpdates.permissions    = [];
        claimUpdates.permissions        = [];
      }
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

    const targetUserRecord = await admin.auth().getUser(uid).catch(() => null);
    if (targetUserRecord?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL) {
      return res.status(403).json({
        error: `The primary admin account ${PRIMARY_ADMIN_EMAIL} cannot be deleted.`,
      });
    }

    // Delete Auth record first; if it's already gone, still clean up Firestore
    try {
      await admin.auth().deleteUser(uid);
    } catch (authErr) {
      if (authErr.code !== 'auth/user-not-found') return next(authErr);
    }

    await Promise.all([
      admin.firestore().collection('users').doc(uid).delete(),
      admin.firestore().collection('emailVerificationTokens').doc(uid).delete().catch(() => {}),
    ]);

    return res.json({ message: 'User deleted.' });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/admin/users/:uid/resend-verification
 * Generates a new email verification link for a staff account.
 */
async function resendVerification(req, res, next) {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ error: 'uid is required.' });

    const verified = await getVerificationStatus(uid);
    if (verified) {
      return res.status(400).json({ error: 'This account is already verified.' });
    }

    const [userRecord, userSnap] = await Promise.all([
      admin.auth().getUser(uid),
      admin.firestore().collection('users').doc(uid).get(),
    ]);
    const userData = userSnap.exists ? userSnap.data() : {};

    // Send the verification email (non-critical, don't fail the request if it errors)
    let emailStatus = 'sent';
    try {
      const emailResult = await sendAccountVerificationEmail(uid, userRecord.email, {
        branchName: userData.branchName || null,
      });
      if (emailResult?.skipped) {
        emailStatus = 'not_sent';
      }
    } catch (emailErr) {
      console.warn('[resendVerification] Email send failed:', emailErr.message);
      emailStatus = 'failed';
    }

    const message = emailStatus === 'sent'
      ? 'Verification email sent.'
      : emailStatus === 'failed'
      ? 'Verification email delivery failed. Please check SMTP credentials.'
      : 'Verification email is not configured. Please configure SMTP.';

    return res.json({ message });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found.' });
    }
    return next(err);
  }
}

/**
 * POST /api/admin/branch-staff
 *
 * Allows a staff user to create another staff account within their own branch.
 * The new staff receives a password-reset email to set their credentials.
 *
 * Request body:
 *   - email        {string}
 *   - customRoleId {string?}
 */
async function createBranchStaff(req, res, next) {
  try {
    const callerBranchId = req.user.branchId;
    if (!callerBranchId) {
      return res.status(403).json({ error: 'You are not assigned to any branch.' });
    }

    const { email, customRoleId } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    const db = admin.firestore();

    // Resolve the caller's branch
    const branchSnap = await db.collection('branches').doc(callerBranchId).get();
    if (!branchSnap.exists) {
      return res.status(404).json({ error: 'Your branch no longer exists.' });
    }
    const branch = branchSnap.data();

    // Resolve custom role
    let sanitizedPerms = [];
    let customRoleName = null;
    if (customRoleId) {
      const roleSnap = await db.collection('roles').doc(customRoleId).get();
      if (!roleSnap.exists) {
        return res.status(404).json({ error: 'Custom role not found.' });
      }
      const roleData = roleSnap.data();
      sanitizedPerms = sanitizePermissions(roleData.permissions || []);
      customRoleName = roleData.name;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Create Firebase Auth user (no password — they set it via reset link)
    const userRecord = await admin.auth().createUser({
      email:         normalizedEmail,
      emailVerified: false,
    });

    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role:        'staff',
      branchId:    callerBranchId,
      location:    branch.name,
      entityType:  branch.type,
      permissions: sanitizedPerms,
      verified:    false,
    });

    await db.collection('users').doc(userRecord.uid).set({
      uid:            userRecord.uid,
      fullName:       '',
      email:          normalizedEmail,
      role:           'staff',
      branchId:       callerBranchId,
      branchName:     branch.name,
      entityType:     branch.type,
      customRoleId:   customRoleId || null,
      customRoleName: customRoleName,
      permissions:    sanitizedPerms,
      verified:       false,
      createdAt:      admin.firestore.FieldValue.serverTimestamp(),
      createdBy:      req.user.uid,
    });

    // Generate password reset link
    const resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail);

    const emailResults = await Promise.allSettled([
      sendPasswordResetEmail(normalizedEmail, resetLink, branch.name),
      sendAccountVerificationEmail(userRecord.uid, normalizedEmail, { branchName: branch.name }),
    ]);
    const emailDelivery = summarizeEmailDeliveries({
      passwordReset: emailResults[0],
      verification: emailResults[1],
    });

    if (!emailDelivery.allSent) {
      console.warn('Staff account created, but one or more emails were not sent.', emailDelivery.summary);
    }

    return res.status(201).json({
      message: emailDelivery.allSent
        ? 'Staff account created. Verification and password-reset emails sent.'
        : 'Staff account created, but one or more emails were not sent.',
      uid:       userRecord.uid,
      email:     normalizedEmail,
      branchId:  callerBranchId,
      branchName: branch.name,
      customRoleId:   customRoleId || null,
      customRoleName,
      emailDelivery: emailDelivery.summary,
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'A user with this email address already exists.' });
    }
    return next(err);
  }
}

/**
 * GET /api/admin/branch-staff
 * Returns staff in the caller's branch.
 */
async function listBranchStaff(req, res, next) {
  try {
    const callerBranchId = req.user.branchId;
    if (!callerBranchId) {
      return res.status(403).json({ error: 'You are not assigned to any branch.' });
    }

    const snap = await admin
      .firestore()
      .collection('users')
      .where('branchId', '==', callerBranchId)
      .get();

    const docsData = snap.docs
      .map((doc) => doc.data())
      .sort((a, b) => {
        const aMs = a.createdAt?.toMillis?.() || 0;
        const bMs = b.createdAt?.toMillis?.() || 0;
        return bMs - aMs;
      });

    const staff = docsData.map((d) => ({
      uid:            d.uid,
      fullName:       d.fullName || '',
      email:          d.email || '',
      role:           d.role || '',
      branchId:       d.branchId || null,
      branchName:     d.branchName || null,
      entityType:     d.entityType || null,
      customRoleId:   d.customRoleId || null,
      customRoleName: d.customRoleName || null,
      permissions:    d.permissions || [],
      verified:       d.verified === true,
      createdAt:      d.createdAt ? d.createdAt.toDate().toISOString() : null,
    }));

    return res.json(staff);
  } catch (err) {
    return next(err);
  }
}

module.exports = { createStaff, createBranchStaff, listBranchStaff, listUsers, updateStaff, deleteUser, resendVerification };

