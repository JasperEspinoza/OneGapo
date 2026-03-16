const admin = require('../config/firebaseAdmin');
const {
  sendPasswordResetEmail,
  summarizeEmailDeliveries,
} = require('../services/emailService');
const { sendAccountVerificationEmail } = require('../services/verificationService');

const ALLOWED_TYPES = ['public', 'private'];

/**
 * POST /api/admin/branches
 * Creates a new branch/barangay entity in Firestore.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createBranch(req, res, next) {
  try {
    const { name, type, staffEmail } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'name and type are required.' });
    }

    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({
        error: `type must be one of: ${ALLOWED_TYPES.join(', ')}.`,
      });
    }

    const trimmedName = String(name).trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'name cannot be blank.' });
    }

    if (staffEmail && !EMAIL_REGEX.test(staffEmail)) {
      return res.status(400).json({ error: 'Invalid staff email address format.' });
    }

    const db = admin.firestore();

    // Prevent duplicate names
    const existing = await db.collection('branches').where('name', '==', trimmedName).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'A branch with this name already exists.' });
    }

    const ref = await db.collection('branches').add({
      name:      trimmedName,
      type,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid,
    });

    // If a staff email was provided, create a staff account and assign to this branch
    let staffCreated = null;
    if (staffEmail) {
      const normalizedEmail = staffEmail.toLowerCase().trim();

      // Create Firebase Auth user (no password — they will set it via reset link)
      const userRecord = await admin.auth().createUser({
        email:         normalizedEmail,
        emailVerified: false,
      });

      // Set custom claims
      await admin.auth().setCustomUserClaims(userRecord.uid, {
        role:       'staff',
        branchId:   ref.id,
        location:   trimmedName,
        entityType: type,
        permissions: [],
        verified:   false,
      });

      // Write Firestore user doc
      await db.collection('users').doc(userRecord.uid).set({
        uid:            userRecord.uid,
        fullName:       '',
        email:          normalizedEmail,
        role:           'staff',
        branchId:       ref.id,
        branchName:     trimmedName,
        entityType:     type,
        customRoleId:   null,
        customRoleName: null,
        permissions:    [],
        verified:       false,
        createdAt:      admin.firestore.FieldValue.serverTimestamp(),
        createdBy:      req.user.uid,
      });

      // Generate password reset link so the staff can set their password
      const resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail);

      const emailResults = await Promise.allSettled([
        sendPasswordResetEmail(normalizedEmail, resetLink, trimmedName),
        sendAccountVerificationEmail(userRecord.uid, normalizedEmail, { branchName: trimmedName }),
      ]);
      const emailDelivery = summarizeEmailDeliveries({
        passwordReset: emailResults[0],
        verification: emailResults[1],
      });

      if (!emailDelivery.allSent) {
        console.warn('Branch created, but one or more staff emails were not sent.', emailDelivery.summary);
      }

      staffCreated = {
        uid: userRecord.uid,
        email: normalizedEmail,
        emailDelivery: emailDelivery.summary,
      };
    }

    return res.status(201).json({
      id: ref.id,
      name: trimmedName,
      type,
      staffCreated,
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'A user with this staff email already exists.' });
    }
    return next(err);
  }
}

/**
 * GET /api/admin/branches
 * Returns all branches ordered by name.
 */
async function listBranches(req, res, next) {
  try {
    const snap = await admin.firestore().collection('branches').orderBy('name').get();
    const branches = snap.docs.map((doc) => ({ id: doc.id, ...doc.data(), createdAt: undefined }));
    return res.json(branches);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/admin/branches/:id
 * Updates an existing branch's name and/or type.
 */
async function updateBranch(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Branch id is required.' });

    const { name, type } = req.body;
    const updates = {};
    const db = admin.firestore();

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'name cannot be blank.' });
      }
      const existing = await db.collection('branches').where('name', '==', trimmedName).get();
      const duplicate = existing.docs.find((doc) => doc.id !== id);
      if (duplicate) {
        return res.status(409).json({ error: 'A branch with this name already exists.' });
      }
      updates.name = trimmedName;
    }

    if (type !== undefined) {
      if (!ALLOWED_TYPES.includes(type)) {
        return res.status(400).json({
          error: `type must be one of: ${ALLOWED_TYPES.join(', ')}.`,
        });
      }
      updates.type = type;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    const docRef = db.collection('branches').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Branch not found.' });
    }

    await docRef.update(updates);

    const updated = { id, ...snap.data(), ...updates, updatedAt: undefined };
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/admin/branches/:id
 * Deletes a branch entity. Does not cascade — staff accounts retain their claims.
 */
async function deleteBranch(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Branch id is required.' });

    await admin.firestore().collection('branches').doc(id).delete();
    return res.json({ message: 'Branch deleted.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createBranch, listBranches, updateBranch, deleteBranch };
