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
const RESPONDER_ROLE_KEY = 'responder';
const RESPONDER_ROLE_LABEL = 'Responder';

// Basic email regex — prevents obviously malformed addresses from reaching Firebase
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRoleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getEffectiveRoleKey(user = {}) {
  const roleKey = normalizeRoleKey(user.role);
  const customRoleKey = normalizeRoleKey(user.customRoleName);

  if (roleKey === RESPONDER_ROLE_KEY || customRoleKey === RESPONDER_ROLE_KEY) {
    return RESPONDER_ROLE_KEY;
  }

  return roleKey || customRoleKey || '';
}

function isResponderAccount(user = {}) {
  return getEffectiveRoleKey(user) === RESPONDER_ROLE_KEY;
}

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
    const normalizedPassword = String(password || '');

    // --- Input validation ---
    if (!email || !role) {
      return res.status(400).json({
        error: 'Missing required fields: email and role are required.',
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
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

    let userRecord = null;
    let existingAccount = false;

    try {
      userRecord = await admin.auth().getUserByEmail(normalizedEmail);
      existingAccount = true;
    } catch (err) {
      if (err.code !== 'auth/user-not-found') {
        throw err;
      }
    }

    if (!userRecord) {
      if (!normalizedPassword) {
        return res.status(400).json({
          error: 'Temporary password is required when creating a new account.',
        });
      }

      if (normalizedPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      }

      userRecord = await admin.auth().createUser({
        email: normalizedEmail,
        password: normalizedPassword,
        emailVerified: false,
      });
    }

    const existingClaims = userRecord.customClaims || {};
    const isVerified = Boolean(existingClaims.verified === true || userRecord.emailVerified === true);

    // --- Assign Custom Claims (role + location context + permissions) ---
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      ...existingClaims,
      role,
      branchId:    branchId || null,
      location:    branch ? branch.name : null,
      entityType:  branch ? branch.type : null,
      customRoleId: customRoleId || null,
      customRoleName: customRoleName || null,
      permissions: sanitizedPerms,
      verified:    isVerified,
    });

    // --- Write Firestore user document ---
    const userDocRef = db.collection('users').doc(userRecord.uid);
    const userDoc = await userDocRef.get();
    await userDocRef.set({
      uid:         userRecord.uid,
      fullName:    userDoc.exists ? (userDoc.data()?.fullName || '') : (userRecord.displayName || ''),
      email:       normalizedEmail,
      role,
      branchId:       branchId || null,
      branchName:     branch ? branch.name : null,
      entityType:     branch ? branch.type : null,
      customRoleId:   customRoleId || null,
      customRoleName: customRoleName || null,
      permissions:    sanitizedPerms,
      verified:       isVerified,
      ...(userDoc.exists
        ? {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.user.uid,
          }
        : {
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.user.uid,
          }),
    }, { merge: true });

    if (!existingAccount && !isVerified) {
      try {
        await sendAccountVerificationEmail(userRecord.uid, userRecord.email, {
          branchName: branch ? branch.name : null,
        });
      } catch (emailErr) {
        console.warn('Failed to send verification email, but account was created. Admin can resend manually.', emailErr.message);
      }
    }

    return res.status(existingAccount ? 200 : 201).json({
      message: existingAccount
        ? 'Existing account assigned successfully.'
        : 'Staff account created successfully. Verification email sent.',
      uid:        userRecord.uid,
      email:      userRecord.email,
      role,
      branchId:       branchId || null,
      location:       branch ? branch.name : null,
      entityType:     branch ? branch.type : null,
      customRoleId:   customRoleId || null,
      customRoleName: customRoleName || null,
      permissions:    sanitizedPerms,
      verified:       isVerified,
    });
  } catch (err) {
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
        // If the custom role is 'Responder', promote to the 'responder' system role
        const derivedRole = String(roleData.name || '').trim().toLowerCase() === 'responder'
          ? 'responder'
          : undefined; // leave current role unchanged if not responder
        firestoreUpdates.customRoleId   = customRoleId;
        firestoreUpdates.customRoleName = roleData.name;
        firestoreUpdates.permissions    = sanitized;
        claimUpdates.permissions        = sanitized;
        claimUpdates.customRoleId       = customRoleId;
        claimUpdates.customRoleName     = roleData.name;
        if (derivedRole) {
          firestoreUpdates.role = derivedRole;
          claimUpdates.role     = derivedRole;
        }
      } else {
        firestoreUpdates.customRoleId   = null;
        firestoreUpdates.customRoleName = null;
        firestoreUpdates.permissions    = [];
        claimUpdates.customRoleId       = null;
        claimUpdates.customRoleName     = null;
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

    // Determine effective role: if the custom role is named 'Responder', use the 'responder' system role
    const effectiveBranchRole = String(customRoleName || '').trim().toLowerCase() === 'responder'
      ? 'responder'
      : 'staff';

    const normalizedEmail = email.toLowerCase().trim();
    if (normalizedEmail === PRIMARY_ADMIN_EMAIL) {
      return res.status(403).json({
        error: `The primary admin account ${PRIMARY_ADMIN_EMAIL} cannot be reassigned.`
      });
    }

    let userRecord = null;
    let existingAccount = false;
    try {
      userRecord = await admin.auth().getUserByEmail(normalizedEmail);
      existingAccount = true;
    } catch (err) {
      if (err.code !== 'auth/user-not-found') {
        throw err;
      }
    }

    if (!userRecord) {
      // Create Firebase Auth user (no password — they set it via reset link)
      userRecord = await admin.auth().createUser({
        email: normalizedEmail,
        emailVerified: false,
      });
    }

    const existingClaims = userRecord.customClaims || {};
    const isVerified = Boolean(existingClaims.verified === true || userRecord.emailVerified === true);

    await admin.auth().setCustomUserClaims(userRecord.uid, {
      ...existingClaims,
      role:        effectiveBranchRole,
      roleKey:     effectiveBranchRole,
      branchId:    callerBranchId,
      location:    branch.name,
      entityType:  branch.type,
      permissions: sanitizedPerms,
      verified:    isVerified,
    });

    const userDocRef = db.collection('users').doc(userRecord.uid);
    const userDoc = await userDocRef.get();
    await userDocRef.set({
      uid:            userRecord.uid,
      fullName:       userDoc.exists ? (userDoc.data()?.fullName || '') : (userRecord.displayName || ''),
      email:          normalizedEmail,
      role:           effectiveBranchRole,
      roleKey:        effectiveBranchRole,
      branchId:       callerBranchId,
      branchName:     branch.name,
      entityType:     branch.type,
      customRoleId:   customRoleId || null,
      customRoleName: customRoleName,
      permissions:    sanitizedPerms,
      verified:       isVerified,
      ...(userDoc.exists
        ? {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.user.uid,
          }
        : {
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.user.uid,
          }),
    }, { merge: true });

    let emailDelivery = null;
    if (!existingAccount) {
      // Generate password reset link only for newly created accounts.
      const resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail);

      const emailResults = await Promise.allSettled([
        sendPasswordResetEmail(normalizedEmail, resetLink, branch.name),
        sendAccountVerificationEmail(userRecord.uid, normalizedEmail, { branchName: branch.name }),
      ]);
      emailDelivery = summarizeEmailDeliveries({
        passwordReset: emailResults[0],
        verification: emailResults[1],
      });

      if (!emailDelivery.allSent) {
        console.warn('Staff account created, but one or more emails were not sent.', emailDelivery.summary);
      }
    }

    return res.status(existingAccount ? 200 : 201).json({
      message: existingAccount
        ? 'Existing staff account assigned to your branch.'
        : emailDelivery?.allSent
          ? 'Staff account created. Verification and password-reset emails sent.'
          : 'Staff account created, but one or more emails were not sent.',
      uid:       userRecord.uid,
      email:     normalizedEmail,
      branchId:  callerBranchId,
      branchName: branch.name,
      customRoleId:   customRoleId || null,
      customRoleName,
      emailDelivery: emailDelivery?.summary,
    });
  } catch (err) {
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

    const db = admin.firestore();

    // Fetch canonical branch name to include users that only have branchName set
    const branchSnap = await db.collection('branches').doc(callerBranchId).get().catch(() => null);
    const callerBranchName = branchSnap && branchSnap.exists ? (branchSnap.data().name || '') : String(req.user.location || '').trim();

    // Query users by branchId and also by branchName as a fallback for legacy/missing branchId entries
    const docs = [];
    const snapById = await db.collection('users').where('branchId', '==', callerBranchId).get();
    docs.push(...snapById.docs);

    if (callerBranchName) {
      try {
        const snapByName = await db.collection('users').where('branchName', '==', callerBranchName).get();
        docs.push(...snapByName.docs);
      } catch (e) {
        // Ignore query errors on branchName fallback and continue with branchId results
      }
    }

    // Deduplicate documents by uid
    const uniqueById = new Map();
    for (const doc of docs) {
      if (!uniqueById.has(doc.id)) uniqueById.set(doc.id, doc);
    }

    const docsData = Array.from(uniqueById.values())
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
      roleKey:        getEffectiveRoleKey(d),
      branchId:       d.branchId || null,
      branchName:     d.branchName || null,
      entityType:     d.entityType || null,
      customRoleId:   d.customRoleId || null,
      customRoleName: d.customRoleName || null,
      customRoleLabel: d.customRoleName || (getEffectiveRoleKey(d) === RESPONDER_ROLE_KEY ? RESPONDER_ROLE_LABEL : null),
      permissions:    d.permissions || [],
      verified:       d.verified === true,
      createdAt:      d.createdAt ? d.createdAt.toDate().toISOString() : null,
    }));

    return res.json(staff);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/admin/migrate-responder-roles
 *
 * One-time migration: finds all users whose customRoleName is 'Responder' but whose
 * system role is still 'staff', and updates both Firebase Custom Claims and Firestore
 * to role:'responder'.
 *
 * Protected: verifyToken + requirePermission('add_staffs').
 */
async function migrateResponderRoles(req, res, next) {
  try {
    const db = admin.firestore();
    const snap = await db.collection('users').get();
    const affected = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((u) => String(u.customRoleName || '').trim().toLowerCase() === 'responder' && u.role !== 'responder');

    if (affected.length === 0) {
      return res.json({ message: 'No accounts need migration.', migrated: 0 });
    }

    const results = await Promise.allSettled(
      affected.map(async (u) => {
        const userRecord = await admin.auth().getUser(u.id);
        const existingClaims = userRecord.customClaims || {};
        await admin.auth().setCustomUserClaims(u.id, { ...existingClaims, role: 'responder' });
        await db.collection('users').doc(u.id).update({
          role: 'responder',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: req.user.uid,
        });
        return u.email;
      })
    );

    const migrated = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const failed   = results.filter((r) => r.status === 'declined').map((r) => r.reason?.message || 'Unknown error');

    return res.json({
      message: `Migration complete. ${migrated.length} account(s) updated.`,
      migrated,
      failed,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createStaff, createBranchStaff, listBranchStaff, listUsers, updateStaff, deleteUser, resendVerification, migrateResponderRoles };

