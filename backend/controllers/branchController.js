const admin = require('../config/firebaseAdmin');

const ALLOWED_TYPES = ['barangay', 'branch'];

/**
 * POST /api/admin/branches
 * Creates a new branch/barangay entity in Firestore.
 */
async function createBranch(req, res, next) {
  try {
    const { name, type } = req.body;

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

    return res.status(201).json({ id: ref.id, name: trimmedName, type });
  } catch (err) {
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

module.exports = { createBranch, listBranches, deleteBranch };
