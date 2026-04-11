const admin = require('../config/firebaseAdmin');
const {
  sendPasswordResetEmail,
  summarizeEmailDeliveries,
} = require('../services/emailService');
const { sendAccountVerificationEmail } = require('../services/verificationService');

const ALLOWED_TYPES = ['public', 'private'];

const DEFAULT_BRANCH_CATALOG = [
  { name: 'Asinan', type: 'public' },
  { name: 'Banicain', type: 'public' },
  { name: 'Barretto', type: 'public' },
  { name: 'East Bajac-Bajac', type: 'public' },
  { name: 'East Tapinac', type: 'public' },
  { name: 'Gordon Heights', type: 'public' },
  { name: 'Kababae', type: 'public' },
  { name: 'Kalaklan', type: 'public' },
  { name: 'Kalalake', type: 'public' },
  { name: 'Mabayuan', type: 'public' },
  { name: 'New Asinan', type: 'public' },
  { name: 'New Cabalan', type: 'public' },
  { name: 'New Ilalim', type: 'public' },
  { name: 'New Kababae', type: 'public' },
  { name: 'New Kalalake', type: 'public' },
  { name: 'Old Cabalan', type: 'public' },
  { name: 'Pag-asa', type: 'public' },
  { name: 'Sta. Rita', type: 'public' },
  { name: 'West Bajac-Bajac', type: 'public' },
  { name: 'West Tapinac', type: 'public' },
  { name: 'SBMA Freeport Zone', type: 'private' },
];

const BRANCH_NAME_ALIASES = new Map([
  ['sta rita', 'Sta. Rita'],
  ['sta. rita', 'Sta. Rita'],
  ['santa rita', 'Sta. Rita'],
  ['sbma', 'SBMA Freeport Zone'],
  ['subic bay metropolitan authority', 'SBMA Freeport Zone'],
  ['subic bay freeport zone', 'SBMA Freeport Zone'],
  ['freeport zone', 'SBMA Freeport Zone'],
]);

function normalizeBranchToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalBranchName(value) {
  const normalized = normalizeBranchToken(value);
  if (!normalized) return '';
  return BRANCH_NAME_ALIASES.get(normalized) || String(value).trim();
}

function branchKey(value) {
  return normalizeBranchToken(canonicalBranchName(value));
}

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
    const canonicalName = canonicalBranchName(trimmedName);

    if (staffEmail && !EMAIL_REGEX.test(staffEmail)) {
      return res.status(400).json({ error: 'Invalid staff email address format.' });
    }

    const db = admin.firestore();

    // Prevent duplicate names
    const existing = await db.collection('branches').get();
    const hasDuplicate = existing.docs.some((doc) => branchKey(doc.data()?.name) === branchKey(canonicalName));
    if (hasDuplicate) {
      return res.status(409).json({ error: 'A branch with this name already exists.' });
    }

    const ref = await db.collection('branches').add({
      name:      canonicalName,
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
        location:   canonicalName,
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
        branchName:     canonicalName,
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
        sendPasswordResetEmail(normalizedEmail, resetLink, canonicalName),
        sendAccountVerificationEmail(userRecord.uid, normalizedEmail, { branchName: canonicalName }),
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
      name: canonicalName,
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
    const branches = snap.docs.map((doc) => {
      const data = doc.data() || {};
      const canonicalName = canonicalBranchName(data.name || '');
      return {
        id: doc.id,
        ...data,
        name: canonicalName || String(data.name || ''),
        createdAt: undefined,
      };
    });
    return res.json(branches);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/admin/branches/provision-defaults
 * Ensures the standard barangay + SBMA branch catalog exists.
 */
async function provisionDefaultBranches(req, res, next) {
  try {
    const db = admin.firestore();
    const existingSnap = await db.collection('branches').get();
    const existingByNormalizedName = new Map(
      existingSnap.docs.map((doc) => {
        const data = doc.data() || {};
        const normalized = branchKey(data.name);
        return [normalized, { id: doc.id, ...data }];
      })
    );

    const created = [];
    const alreadyPresent = [];

    for (const branch of DEFAULT_BRANCH_CATALOG) {
      const canonicalName = canonicalBranchName(branch.name);
      const normalized = branchKey(canonicalName);
      if (existingByNormalizedName.has(normalized)) {
        alreadyPresent.push(canonicalName);
        continue;
      }

      const ref = await db.collection('branches').add({
        name: canonicalName,
        type: branch.type,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: req.user.uid,
        seeded: true,
      });

      created.push({ id: ref.id, name: canonicalName, type: branch.type });
      existingByNormalizedName.set(normalized, { id: ref.id, name: canonicalName, type: branch.type });
    }

    return res.json({
      message: 'Default branch catalog provisioned.',
      totalDefaults: DEFAULT_BRANCH_CATALOG.length,
      createdCount: created.length,
      existingCount: alreadyPresent.length,
      created,
      existing: alreadyPresent,
    });
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

    const { name, type, staffEmail } = req.body;
    const updates = {};
    const db = admin.firestore();

    if (staffEmail !== undefined && staffEmail !== null && String(staffEmail).trim() !== '') {
      const normalized = String(staffEmail).trim().toLowerCase();
      if (!EMAIL_REGEX.test(normalized)) {
        return res.status(400).json({ error: 'Invalid staff email address format.' });
      }
    }

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'name cannot be blank.' });
      }
      const canonicalName = canonicalBranchName(trimmedName);
      const existing = await db.collection('branches').get();
      const duplicate = existing.docs.find((doc) => doc.id !== id && branchKey(doc.data()?.name) === branchKey(canonicalName));
      if (duplicate) {
        return res.status(409).json({ error: 'A branch with this name already exists.' });
      }
      updates.name = canonicalName;
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

    const finalBranchName = updates.name || String(snap.data()?.name || '');
    const finalBranchType = updates.type || String(snap.data()?.type || 'public');

    let staffReassignment = null;
    const normalizedStaffEmail = String(staffEmail || '').trim().toLowerCase();
    if (normalizedStaffEmail) {
      const existingUserSnap = await db
        .collection('users')
        .where('email', '==', normalizedStaffEmail)
        .limit(1)
        .get();

      if (!existingUserSnap.empty) {
        const existingDoc = existingUserSnap.docs[0];
        const existingUser = existingDoc.data() || {};
        const targetUid = String(existingUser.uid || existingDoc.id || '').trim();

        await existingDoc.ref.set(
          {
            uid: targetUid,
            role: 'staff',
            branchId: id,
            branchName: finalBranchName,
            entityType: finalBranchType,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: req.user.uid,
          },
          { merge: true }
        );

        const authUser = await admin.auth().getUser(targetUid);
        const existingClaims = authUser.customClaims || {};
        await admin.auth().setCustomUserClaims(targetUid, {
          ...existingClaims,
          role: 'staff',
          branchId: id,
          location: finalBranchName,
          entityType: finalBranchType,
        });

        staffReassignment = {
          uid: targetUid,
          email: normalizedStaffEmail,
          created: false,
        };
      } else {
        const userRecord = await admin.auth().createUser({
          email: normalizedStaffEmail,
          emailVerified: false,
        });

        await admin.auth().setCustomUserClaims(userRecord.uid, {
          role: 'staff',
          branchId: id,
          location: finalBranchName,
          entityType: finalBranchType,
          permissions: [],
          verified: false,
        });

        await db.collection('users').doc(userRecord.uid).set({
          uid: userRecord.uid,
          fullName: '',
          email: normalizedStaffEmail,
          role: 'staff',
          branchId: id,
          branchName: finalBranchName,
          entityType: finalBranchType,
          customRoleId: null,
          customRoleName: null,
          permissions: [],
          verified: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: req.user.uid,
        });

        const resetLink = await admin.auth().generatePasswordResetLink(normalizedStaffEmail);
        const emailResults = await Promise.allSettled([
          sendPasswordResetEmail(normalizedStaffEmail, resetLink, finalBranchName),
          sendAccountVerificationEmail(userRecord.uid, normalizedStaffEmail, { branchName: finalBranchName }),
        ]);

        const emailDelivery = summarizeEmailDeliveries({
          passwordReset: emailResults[0],
          verification: emailResults[1],
        });

        staffReassignment = {
          uid: userRecord.uid,
          email: normalizedStaffEmail,
          created: true,
          emailDelivery: emailDelivery.summary,
        };
      }
    }

    const updated = {
      id,
      ...snap.data(),
      ...updates,
      updatedAt: undefined,
      staffReassignment,
    };
    return res.json(updated);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'A user with this staff email already exists.' });
    }
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

module.exports = {
  createBranch,
  listBranches,
  provisionDefaultBranches,
  updateBranch,
  deleteBranch,
};
